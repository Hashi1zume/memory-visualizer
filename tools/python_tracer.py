import contextlib
import io
import json
from collections.abc import Iterable
import runpy
import sys
import traceback

MAX_STEPS = 5000


def object_id(value):
    return f"py-{id(value)}"


def summarize_value(value):
    if isinstance(value, (int, float, bool)) or value is None:
        return {"kind": "scalar", "value": repr(value)}
    if isinstance(value, str):
        return {"kind": "scalar", "value": repr(value[:80])}
    if isinstance(value, (list, tuple, set)):
        return {
            "kind": "object",
            "summary": f"{type(value).__name__}(len={len(value)})",
            "preview": repr(list(value)[:8]),
        }
    if isinstance(value, dict):
        return {
            "kind": "object",
            "summary": f"dict(len={len(value)})",
            "preview": repr(list(value.items())[:8]),
        }
    shape = getattr(value, "shape", None)
    dtype = getattr(value, "dtype", None)
    if shape is not None and dtype is not None and isinstance(shape, Iterable) and not isinstance(shape, (str, bytes)):
        shape_values = list(shape)
        return {
            "kind": "matrix",
            "summary": f"ndarray(shape={tuple(shape_values)}, dtype={dtype})",
            "shape": shape_values,
            "dtype": str(dtype),
        }
    return {"kind": "object", "summary": type(value).__name__, "preview": repr(value)[:120]}


def serialize_frame(frame):
    variables = []
    blocks = {}
    edges = []

    for name, value in frame.f_locals.items():
        if name.startswith("__"):
            continue

        summary = summarize_value(value)
        if summary["kind"] == "scalar":
            variables.append({
                "name": name,
                "value": summary["value"],
                "type": "scalar",
                "address": "",
            })
            continue

        current_object_id = object_id(value)
        variables.append({
            "name": name,
            "value": current_object_id,
            "type": "reference",
            "address": current_object_id,
        })
        blocks[current_object_id] = {
            "id": current_object_id,
            "name": type(value).__name__,
            "segment": "heap",
            "address": current_object_id,
            "size": sys.getsizeof(value),
            "status": "live",
            "summary": summary.get("summary", summary.get("preview", type(value).__name__)),
            "order": len(blocks),
        }
        edges.append({
            "id": f"{name}-{current_object_id}",
            "from": name,
            "to": current_object_id,
            "label": "id(obj)",
            "state": "valid",
            "address": current_object_id,
            "previousTo": None,
        })

    return variables, list(blocks.values()), edges


def trace_file(target_path):
    steps = []

    def tracer(frame, event, arg):
        if event != "line" or len(steps) >= MAX_STEPS:
            return tracer
        if frame.f_code.co_filename != target_path:
            return tracer

        variables, blocks, edges = serialize_frame(frame)
        steps.append({
            "index": len(steps),
            "line": frame.f_lineno,
            "event": "Python line",
            "frames": [{
                "id": f"frame-{frame.f_code.co_name}",
                "name": frame.f_code.co_name,
                "variables": variables,
            }],
            "memoryBlocks": blocks,
            "pointerEdges": edges,
            "matrix": None,
            "output": "",
        })
        return tracer

    stdout = io.StringIO()
    stderr = ""
    status = "completed"
    sys.settrace(tracer)
    try:
        with contextlib.redirect_stdout(stdout):
            runpy.run_path(target_path, run_name="__main__")
    except Exception:
        status = "error"
        stderr = traceback.format_exc()
    finally:
        sys.settrace(None)

    captured_stdout = stdout.getvalue()
    if steps:
        steps[-1]["output"] = captured_stdout

    return {
        "id": "python311-real",
        "language": "python311",
        "status": status,
        "totalSteps": len(steps),
        "steps": steps,
        "stdout": captured_stdout,
        "stderr": stderr,
        "limits": {
            "maxEvents": MAX_STEPS,
        },
    }


if __name__ == "__main__":
    print(json.dumps(trace_file(sys.argv[1]), ensure_ascii=False))
