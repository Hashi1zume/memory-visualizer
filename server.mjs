import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTrace } from "./src/traceEngine.js";

const root = process.cwd();
const serverDir = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const runTimeoutMs = 10000;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function resolveRequestPath(url) {
  const requestedPath = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const safePath = normalize(requestedPath === "/" ? "/index.html" : requestedPath);
  return join(root, safePath);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs || runTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function splitLeadingIncludes(code) {
  const lines = code.split("\n");
  const includes = [];
  const rest = [];
  let stillReadingIncludes = true;

  for (const line of lines) {
    if (stillReadingIncludes && /^\s*#\s*include\b/.test(line)) {
      includes.push(line);
      continue;
    }
    if (line.trim() !== "") {
      stillReadingIncludes = false;
    }
    rest.push(line);
  }

  return { includes: includes.join("\n"), body: rest.join("\n") };
}

function createCInstrumentedSource(code) {
  const { includes, body } = splitLeadingIncludes(code);
  return `${includes}
#include <stdio.h>
#include <stdlib.h>

static void* mv_malloc(size_t size, const char* file, int line) {
  void* pointer = malloc(size);
  fprintf(stderr, "__MV_EVENT__:{\\"kind\\":\\"malloc\\",\\"address\\":\\"%p\\",\\"size\\":%zu,\\"line\\":%d}\\n", pointer, size, line);
  return pointer;
}

static void mv_free(void* pointer, const char* file, int line) {
  fprintf(stderr, "__MV_EVENT__:{\\"kind\\":\\"free\\",\\"address\\":\\"%p\\",\\"size\\":0,\\"line\\":%d}\\n", pointer, line);
  free(pointer);
}

#define malloc(size) mv_malloc(size, __FILE__, __LINE__)
#define free(pointer) mv_free(pointer, __FILE__, __LINE__)

${body}
`;
}

function createCppInstrumentedSource(code) {
  const { includes, body } = splitLeadingIncludes(code);
  return `${includes}
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <new>

void* operator new(std::size_t size) {
  void* pointer = std::malloc(size);
  if (!pointer) {
    throw std::bad_alloc();
  }
  std::fprintf(stderr, "__MV_EVENT__:{\\"kind\\":\\"new\\",\\"address\\":\\"%p\\",\\"size\\":%zu,\\"line\\":0}\\n", pointer, size);
  return pointer;
}

void operator delete(void* pointer) noexcept {
  std::fprintf(stderr, "__MV_EVENT__:{\\"kind\\":\\"delete\\",\\"address\\":\\"%p\\",\\"size\\":0,\\"line\\":0}\\n", pointer);
  std::free(pointer);
}

static void* mv_malloc(std::size_t size, const char* file, int line) {
  void* pointer = std::malloc(size);
  std::fprintf(stderr, "__MV_EVENT__:{\\"kind\\":\\"malloc\\",\\"address\\":\\"%p\\",\\"size\\":%zu,\\"line\\":%d}\\n", pointer, size, line);
  return pointer;
}

static void mv_free(void* pointer, const char* file, int line) {
  std::fprintf(stderr, "__MV_EVENT__:{\\"kind\\":\\"free\\",\\"address\\":\\"%p\\",\\"size\\":0,\\"line\\":%d}\\n", pointer, line);
  std::free(pointer);
}

#define malloc(size) mv_malloc(size, __FILE__, __LINE__)
#define free(pointer) mv_free(pointer, __FILE__, __LINE__)

${body}
`;
}

function parseNativeMemoryEvents(stderr) {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("__MV_EVENT__:"))
    .map((line) => {
      try {
        return JSON.parse(line.replace("__MV_EVENT__:", ""));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseAllocationTargets(code) {
  const targets = [];
  const nativeAllocationPattern = /\b(?:auto|int|long|float|double|char|void|std::\w+(?:<[^;]+>)?)\s*\*+\s*([a-zA-Z_]\w*)\s*=\s*(malloc|calloc|realloc|new)\b/g;
  for (const match of code.matchAll(nativeAllocationPattern)) {
    targets.push({
      name: match[1],
      kind: match[2] === "new" ? "new" : "malloc"
    });
  }
  return targets;
}

function removeMemoryEventLines(stderr) {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith("__MV_EVENT__:"))
    .join("\n")
    .trim();
}

function createRuntimeBaseTrace(language, code) {
  const trace = generateTrace(language, code);
  const steps = trace.steps
    .filter((step) => !step.event.startsWith("heap に") && !step.event.startsWith("解放済み"))
    .map((step, index) => ({ ...step, index }));
  return {
    ...trace,
    totalSteps: steps.length,
    steps
  };
}

function appendNativeMemoryEvents(trace, memoryEvents, allocationTargets, stdout, stderr, compileOutput = "") {
  const steps = [...trace.steps];
  const blocksByAddress = new Map();
  const pendingTargets = [...allocationTargets];
  let lastStep = steps[steps.length - 1] || {
    frames: [{ id: "frame-main", name: "main", variables: [] }],
    memoryBlocks: [],
    pointerEdges: []
  };

  for (const event of memoryEvents) {
    const currentBlocks = lastStep.memoryBlocks.map((block) => ({ ...block }));
    const currentEdges = lastStep.pointerEdges.map((edge) => ({ ...edge }));
    const currentFrames = lastStep.frames.map((frame) => ({
      ...frame,
      variables: frame.variables.map((variable) => ({ ...variable }))
    }));

    if (event.kind === "malloc" || event.kind === "new") {
      const targetIndex = pendingTargets.findIndex((target) => target.kind === event.kind);
      const allocationTarget = targetIndex >= 0 ? pendingTargets.splice(targetIndex, 1)[0] : null;
      const block = {
        id: `native-${event.address}`,
        name: allocationTarget?.name || event.kind,
        segment: "heap",
        address: event.address,
        size: event.size,
        status: "live",
        summary: `${event.kind} ${event.size}B`,
        order: currentBlocks.length
      };
      blocksByAddress.set(event.address, block.id);
      currentBlocks.push(block);

      if (allocationTarget && currentFrames[0]) {
        const existingVariable = currentFrames[0].variables.find((variable) => variable.name === allocationTarget.name);
        if (existingVariable) {
          existingVariable.value = event.address;
          existingVariable.type = "pointer";
        } else {
          currentFrames[0].variables.push({
            name: allocationTarget.name,
            value: event.address,
            type: "pointer",
            address: event.address
          });
        }
        for (let index = currentEdges.length - 1; index >= 0; index -= 1) {
          if (currentEdges[index].from === allocationTarget.name && currentEdges[index].state === "out-of-range") {
            currentEdges.splice(index, 1);
          }
        }
        currentEdges.push({
          id: `${allocationTarget.name}-${event.address}`,
          from: allocationTarget.name,
          to: block.id,
          label: event.address,
          state: "valid",
          address: event.address,
          previousTo: null
        });
      }
    }
    if (event.kind === "free" || event.kind === "delete") {
      const blockId = blocksByAddress.get(event.address);
      for (const block of currentBlocks) {
        if (block.id === blockId || block.address === event.address) {
          block.status = "freed";
        }
      }
      for (const edge of currentEdges) {
        if (edge.address === event.address || edge.to === blockId) {
          edge.state = "dangling";
        }
      }
    }

    lastStep = {
      index: steps.length,
      line: event.line || lastStep.line || 1,
      event: `${event.kind} ${event.address}`,
      frames: currentFrames,
      memoryBlocks: currentBlocks,
      pointerEdges: currentEdges,
      matrix: null,
      output: stdout
    };
    steps.push(lastStep);
  }

  if (steps.length > 0) {
    steps[steps.length - 1].output = stdout;
  }

  return {
    ...trace,
    status: stderr || compileOutput ? "completed-with-diagnostics" : "completed",
    totalSteps: steps.length,
    steps,
    stdout,
    stderr,
    compileOutput,
    runtimeMemoryEvents: memoryEvents
  };
}

async function runPythonTrace(code, stdin) {
  const workDir = await mkdtemp(join(tmpdir(), "memory-visualizer-python-"));
  try {
    const targetPath = join(workDir, "main.py");
    await writeFile(targetPath, code, "utf8");
    const result = await runCommand("python3.11", [join(serverDir, "tools/python_tracer.py"), targetPath], {
      cwd: workDir,
      stdin,
      timeoutMs: runTimeoutMs
    });
    if (result.code !== 0) {
      return {
        ...generateTrace("python311", code),
        status: "error",
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
    return JSON.parse(result.stdout);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runNativeTrace(language, code, stdin) {
  const workDir = await mkdtemp(join(tmpdir(), `memory-visualizer-${language}-`));
  try {
    const extension = language === "cpp" ? "cpp" : "c";
    const compiler = language === "cpp" ? "g++" : "gcc";
    const sourcePath = join(workDir, `main.${extension}`);
    const binaryPath = join(workDir, "program");
    const instrumentedCode = language === "cpp"
      ? createCppInstrumentedSource(code)
      : createCInstrumentedSource(code);

    await writeFile(sourcePath, instrumentedCode, "utf8");
    const compile = await runCommand(compiler, ["-g", "-O0", sourcePath, "-o", binaryPath], {
      cwd: workDir,
      timeoutMs: runTimeoutMs
    });
    const baseTrace = createRuntimeBaseTrace(language, code);
    if (compile.code !== 0) {
      return {
        ...baseTrace,
        status: "compile-error",
        stdout: compile.stdout,
        stderr: compile.stderr,
        compileOutput: compile.stderr
      };
    }

    const run = await runCommand(binaryPath, [], {
      cwd: workDir,
      stdin,
      timeoutMs: runTimeoutMs
    });
    const memoryEvents = parseNativeMemoryEvents(run.stderr);
    return appendNativeMemoryEvents(
      baseTrace,
      memoryEvents,
      parseAllocationTargets(code),
      run.stdout,
      removeMemoryEventLines(run.stderr),
      compile.stderr
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function handleRunRequest(request, response) {
  try {
    const body = JSON.parse(await readRequestBody(request));
    const language = body.language;
    const code = String(body.code || "");
    const stdin = String(body.stdin || "");
    const trace = language === "python311"
      ? await runPythonTrace(code, stdin)
      : await runNativeTrace(language, code, stdin);

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(trace));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: String(error?.message || error) }));
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/run") {
      await handleRunRequest(request, response);
      return;
    }

    const filePath = resolveRequestPath(request.url || "/");
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Memory Visualizer: http://${host}:${port}`);
});
