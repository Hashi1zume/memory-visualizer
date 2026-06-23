# Memory Visualizer

[日本語版 README](./README.ja.md)

A browser-based memory visualizer for Python 3.11, C, and C++. It executes code locally and shows variable values, memory blocks, references, and step-by-step state changes.

## What This Repository Can Do

- Run Python 3.11, C, and C++ code from the browser.
- Move through execution one step at a time with `Prev` / `Next`.
- Show the currently executing source line with an arrow.
- Show variable values and how they changed from the previous step.
- Show Python object references and C/C++ pointer references with arrows.
- Show memory block creation, changes, and deallocation.
- Show stdout, stderr, and C/C++ compile errors.

## Start

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4173
```

## If You Cannot Access the Page

Check connectivity:

```bash
curl -I http://127.0.0.1:4173
```

If you see `Could not connect` or `Failed to connect`, the server is not running.

```bash
npm run dev
```

Check again from another terminal:

```bash
curl -I http://127.0.0.1:4173
```

`HTTP/1.1 200 OK` means the server is running.

Reload the browser if the page looks stale.

## Usage

1. Select a language.
2. Type code directly or attach a `.py`, `.c`, `.cpp`, `.cc`, or `.cxx` file.
3. Click `実行して可視化`.
4. Use `Prev` / `Next` to move one step at a time.
5. Use `First` / `Last` to jump to the first or last step.

## UI Sections

- `Code`: Shows the currently executing line with an arrow.
- `Stack / Heap`: Shows variables, objects, memory blocks, and reference arrows.
- `Value Changes`: Shows changes in variable values.
- `Memory Changes`: Shows memory block creation, updates, and deallocation.
- `Output`: Shows stdout, stderr, and compile errors.

## Value Meanings

### Step

- `1 / 10 steps`: Current step / total steps.
- `First`: Move to the first step.
- `Prev`: Move back one step.
- `Next`: Move forward one step.
- `Last`: Move to the final step.
- `L<number>`: Current source line.

### Code

- `➜`: Current execution line.
- Line number: Source line number.
- Yellow line: Line corresponding to the current step.

### Stack / Heap

- `Variables`: Currently visible variables.
- `Memory`: Objects and memory blocks referenced by variables.
- Arrow: Relationship from a variable to its referenced memory.
- Faint arrow: Normal reference.
- Strong arrow: Selected, hovered, or changed variable reference.
- `scalar`: Direct value such as a number or string.
- `reference`: Python object reference.
- `pointer`: C/C++ pointer.
- `live`: Valid memory.
- `freed`: Deallocated memory.

### Value Changes

- `new`: Variable newly visible at this step.
- `changed`: Variable value changed from the previous step.
- `removed`: Variable existed in the previous step but is no longer visible.
- Left value: Before.
- Right value: After.

### Memory Changes

- `new`: Newly created object or memory block.
- `changed`: Memory block content, size, or status changed.
- `removed`: Memory block existed in the previous step but is no longer visible.
- `B`: Bytes.

### Output

- `stdout`: Standard output from `print`, `printf`, `cout`, etc.
- `stderr`: Runtime errors or diagnostic output.
- `compile`: C/C++ compile errors.

## Maintenance Commands

Run tests:

```bash
npm test
```

Check Node syntax:

```bash
node --check src/app.js
node --check server.mjs
```

Check Python tracer syntax:

```bash
python3.11 -m py_compile tools/python_tracer.py
```

## Main Files

- `server.mjs`: Static file server, execution API, C/C++ compile and run path.
- `tools/python_tracer.py`: Python 3.11 execution tracer.
- `src/app.js`: UI and step controls.
- `src/stateDiff.js`: Variable and memory diff logic.
- `src/traceEngine.js`: Demo trace generator.
- `src/styles.css`: UI layout.

## Notes

- This server is for local development.
- Do not expose it as a public server because it runs arbitrary code.
- C/C++ requires `gcc` and `g++`.
- Python requires `python3.11`.
