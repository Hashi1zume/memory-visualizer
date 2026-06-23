import { createLanguageState, languages } from "./samplePrograms.js";
import { detectLanguageFromFileName, readTextFile } from "./fileImport.js";
import { getStep } from "./traceEngine.js";
import { runRealTrace } from "./realTraceClient.js";
import {
  compareMemoryBlocks,
  compareVariables,
  getMemoryChangeMap,
  getVariableChangeMap
} from "./stateDiff.js";

const app = document.querySelector("#app");
const state = {
  activeLanguage: "python311",
  languageState: createLanguageState(),
  selectedPointer: null,
  hoveredPointer: null,
  isRunning: false,
  runError: "",
  loadedFileName: ""
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function activeLanguageMeta() {
  return languages.find((language) => language.id === state.activeLanguage);
}

function activeDocument() {
  return state.languageState[state.activeLanguage];
}

function safeRender() {
  try {
    render();
  } catch (error) {
    state.isRunning = false;
    state.runError = `画面の更新に失敗しました: ${String(error?.message || error)}`;
    app.innerHTML = `
      ${renderEditor()}
      <section class="step-panel empty-panel">
        ${escapeHtml(state.runError)}
      </section>
    `;
  }
}

function setActiveLanguage(languageId) {
  state.activeLanguage = languageId;
  state.selectedPointer = null;
  safeRender();
}

function updateActiveCode(code) {
  activeDocument().code = code;
}

async function importCodeFile(file) {
  if (!file) {
    return;
  }

  const detectedLanguage = detectLanguageFromFileName(file.name);
  if (!detectedLanguage) {
    state.runError = "対応しているファイルは .py / .c / .cpp / .cc / .cxx です。";
    safeRender();
    return;
  }

  try {
    const code = await readTextFile(file);
    state.activeLanguage = detectedLanguage;
    const documentState = activeDocument();
    documentState.code = code;
    documentState.trace = null;
    documentState.selectedStepIndex = 0;
    state.selectedPointer = null;
    state.loadedFileName = file.name;
    state.runError = "";
  } catch (error) {
    state.runError = String(error?.message || error);
  }
  safeRender();
}

async function runActiveTrace() {
  const documentState = activeDocument();
  state.isRunning = true;
  state.runError = "";
  safeRender();

  try {
    documentState.trace = await runRealTrace(state.activeLanguage, documentState.code, documentState.stdin);
    documentState.selectedStepIndex = 0;
    state.selectedPointer = null;
  } catch (error) {
    state.runError = String(error?.message || error);
  } finally {
    state.isRunning = false;
    safeRender();
  }
}

function selectStep(stepIndex) {
  const documentState = activeDocument();
  const maxStepIndex = Math.max(0, (documentState.trace?.steps.length || 1) - 1);
  documentState.selectedStepIndex = Math.min(Math.max(stepIndex, 0), maxStepIndex);
  state.selectedPointer = null;
  safeRender();
}

function moveStep(direction) {
  const documentState = activeDocument();
  if (!documentState.trace) {
    return;
  }

  selectStep(documentState.selectedStepIndex + direction);
}

function selectPointer(pointerName) {
  state.selectedPointer = state.selectedPointer === pointerName ? null : pointerName;
  safeRender();
}

function setHoveredPointer(pointerName) {
  if (state.hoveredPointer === pointerName) {
    return;
  }
  state.hoveredPointer = pointerName;
  requestAnimationFrame(() => {
    const documentState = activeDocument();
    drawPointerEdges(getStep(documentState.trace, documentState.selectedStepIndex));
  });
}

function renderLanguageTabs() {
  return `
    <div class="language-tabs" role="tablist" aria-label="言語">
      ${languages.map((language) => `
        <button
          class="language-tab ${language.id === state.activeLanguage ? "is-active" : ""}"
          type="button"
          data-action="switch-language"
          data-language="${language.id}"
        >
          ${language.label}
        </button>
      `).join("")}
    </div>
  `;
}

function renderEditor() {
  const language = activeLanguageMeta();
  return `
    <section class="editor-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${language.fileName}</p>
          <h1>Memory Visualizer</h1>
        </div>
        <label class="file-import-button">
          コードを添付
          <input type="file" data-role="file-input" accept=".py,.c,.cc,.cpp,.cxx,text/x-python,text/x-c,text/x-c++" />
        </label>
        <button class="primary-button" type="button" data-action="run-trace" ${state.isRunning ? "disabled" : ""}>
          ${state.isRunning ? "実行中" : "実行して可視化"}
        </button>
      </div>
      ${renderLanguageTabs()}
      <div class="editor-status-row">
        <span>${state.loadedFileName ? `${escapeHtml(state.loadedFileName)} を読み込み済み` : "エディタへ直接入力、またはコードファイルを添付してください。"}</span>
        <span>${state.isRunning ? "実行中..." : activeDocument().trace ? `${activeDocument().trace.totalSteps} steps loaded` : "未実行"}</span>
      </div>
      <textarea class="code-editor" spellcheck="false" data-role="code-editor">${escapeHtml(activeDocument().code)}</textarea>
      ${state.runError ? `<p class="run-error">${escapeHtml(state.runError)}</p>` : ""}
    </section>
  `;
}

function renderSourceTrace(code, step) {
  const currentLine = step?.line || 0;
  const lines = code.split("\n");

  return `
    <section class="source-trace-panel layout-code">
      <div class="panel-title-row">
        <h2>Code</h2>
        <span>${currentLine ? `L${currentLine}` : "not started"}</span>
      </div>
      <div class="source-lines">
        ${lines.map((line, index) => {
          const lineNumber = index + 1;
          return `
            <div class="source-line ${lineNumber === currentLine ? "is-current" : ""}">
              <span class="execution-arrow">${lineNumber === currentLine ? "➜" : ""}</span>
              <span>${lineNumber}</span>
              <code>${escapeHtml(line || " ")}</code>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderTimeline(trace, selectedStepIndex) {
  if (!trace) {
    return `<section class="step-panel empty-panel">実行するとステップ操作が表示されます。</section>`;
  }

  const isFirstStep = selectedStepIndex <= 0;
  const isLastStep = selectedStepIndex >= trace.steps.length - 1;
  const currentStep = trace.steps[selectedStepIndex];
  const progressPercent = trace.totalSteps <= 1
    ? 100
    : Math.round((selectedStepIndex / (trace.totalSteps - 1)) * 100);

  return `
    <section class="step-panel">
      <div class="panel-title-row">
        <h2>Step</h2>
        <span>${selectedStepIndex + 1} / ${trace.totalSteps} steps</span>
      </div>
      <div class="step-controls" aria-label="ステップ操作">
        <button class="step-control-button" type="button" data-action="first-step" ${isFirstStep ? "disabled" : ""}>First</button>
        <button class="step-control-button" type="button" data-action="prev-step" ${isFirstStep ? "disabled" : ""}>Prev</button>
        <strong>#${selectedStepIndex + 1}</strong>
        <button class="step-control-button" type="button" data-action="next-step" ${isLastStep ? "disabled" : ""}>Next</button>
        <button class="step-control-button" type="button" data-action="last-step" ${isLastStep ? "disabled" : ""}>Last</button>
      </div>
      <div class="step-progress" aria-label="実行ステップ進捗">
        <span style="width:${progressPercent}%"></span>
      </div>
      <div class="current-step-summary">
        <strong>L${currentStep?.line || "-"}</strong>
        <span>${escapeHtml(currentStep?.event || "")}</span>
      </div>
    </section>
  `;
}

function getVariableDisplayValue(variable, step) {
  if (variable.type !== "reference" && variable.type !== "pointer") {
    return variable.value;
  }

  const edge = step?.pointerEdges?.find((candidate) => candidate.from === variable.name);
  const block = step?.memoryBlocks?.find((candidate) => candidate.id === edge?.to || candidate.address === variable.value);
  return block?.summary || edge?.label || variable.value;
}

function renderStack(step, previousStep) {
  if (!step) {
    return `<section class="stack-panel empty-panel">スタックは未取得です。</section>`;
  }

  const changeMap = getVariableChangeMap(previousStep, step);

  return `
    <section class="stack-panel layout-variables">
      <div class="panel-title-row">
        <h2>Variables</h2>
        <span>${step.frames[0].name}</span>
      </div>
      <div class="variable-list">
        ${step.frames[0].variables.map((variable) => `
          <button
            class="variable-row ${variable.type === "pointer" || variable.type === "reference" ? "is-pointer" : ""} ${state.selectedPointer === variable.name ? "is-selected" : ""} ${changeMap.has(variable.name) ? `is-${changeMap.get(variable.name)}` : ""}"
            type="button"
            data-node-id="${variable.name}"
            data-action="select-pointer"
            data-pointer="${variable.name}"
            data-hover-pointer="${variable.name}"
          >
            <span>${escapeHtml(variable.name)}</span>
            <strong>${escapeHtml(getVariableDisplayValue(variable, step))}</strong>
            <small>${escapeHtml(changeMap.get(variable.name) || variable.type)}</small>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function formatChangeType(type) {
  if (type === "created") {
    return "new";
  }
  if (type === "changed") {
    return "changed";
  }
  return "removed";
}

function getReadableChangeValue(rawValue, step) {
  if (!rawValue) {
    return "-";
  }
  const block = step?.memoryBlocks?.find((candidate) => candidate.id === rawValue || candidate.address === rawValue);
  return block?.summary || rawValue;
}

function renderValueChanges(step, previousStep) {
  if (!step) {
    return `<section class="change-panel layout-value-changes empty-panel">実行後、格納された値の変化を表示します。</section>`;
  }

  const changes = compareVariables(previousStep, step);

  return `
    <section class="change-panel layout-value-changes">
      <div class="panel-title-row">
        <h2>Value Changes</h2>
        <span>${changes.length} changes</span>
      </div>
      ${changes.length === 0 ? "<p class=\"muted-copy\">このステップでは変数に格納された値は変化していません。</p>" : `
        <div class="change-table">
          ${changes.map((change) => `
            <div class="change-row is-${change.type}">
              <span>${formatChangeType(change.type)}</span>
              <strong>${escapeHtml(change.name)}</strong>
              <code>${escapeHtml(getReadableChangeValue(change.before, previousStep))}</code>
              <code>${escapeHtml(getReadableChangeValue(change.after, step))}</code>
            </div>
          `).join("")}
        </div>
      `}
    </section>
  `;
}

function renderMemoryChanges(step, previousStep) {
  if (!step) {
    return `<section class="change-panel layout-memory-changes empty-panel">実行後、メモリブロックの変化を表示します。</section>`;
  }

  const changes = compareMemoryBlocks(previousStep, step);

  return `
    <section class="change-panel layout-memory-changes">
      <div class="panel-title-row">
        <h2>Memory Changes</h2>
        <span>${changes.length} changes</span>
      </div>
      ${changes.length === 0 ? "<p class=\"muted-copy\">このステップではメモリ状態は変化していません。</p>" : `
        <div class="change-table">
          ${changes.map((change) => `
            <div class="change-row is-${change.type}">
              <span>${formatChangeType(change.type)}</span>
              <strong>${escapeHtml(change.block.name || change.id)}</strong>
              <code>${escapeHtml(change.before || "-")}</code>
              <code>${escapeHtml(change.after || "-")}</code>
            </div>
          `).join("")}
        </div>
      `}
    </section>
  `;
}

function renderHeap(step, previousStep) {
  if (!step) {
    return `<section class="heap-panel layout-memory empty-panel">メモリは未取得です。</section>`;
  }

  const memoryChangeMap = getMemoryChangeMap(previousStep, step);

  return `
    <section class="heap-panel layout-memory">
      <div class="panel-title-row">
        <h2>Stack / Heap</h2>
        <span>${step.memoryBlocks.length} blocks</span>
      </div>
      <div class="memory-stage memory-only-stage" data-role="memory-stage">
        <div class="heap-column">
          ${step.memoryBlocks.map((block) => `
            <button
              class="memory-node block-node is-${block.status} ${memoryChangeMap.has(block.id) ? `is-${memoryChangeMap.get(block.id)}` : ""}"
              type="button"
              data-node-id="${block.id}"
            >
              <span>${block.name}</span>
              <strong>${block.summary}</strong>
              <small>${block.segment} ${block.address} / ${block.size}B</small>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="pointer-legend">
        <span><i class="legend-line valid"></i>有効</span>
        <span><i class="legend-line dangling"></i>dangling</span>
        <span><i class="legend-line null"></i>NULL/nullptr</span>
      </div>
    </section>
  `;
}

function renderMatrix(step) {
  const matrix = step?.matrix;
  if (!matrix) {
    return `<section class="matrix-panel empty-panel">巨大行列は要約・タイル・差分で表示します。</section>`;
  }

  const cells = Array.from({ length: 144 }, (_, index) => {
    const row = Math.floor(index / 12);
    const col = index % 12;
    const changedTile = matrix.changedTiles.find((tile) => tile.row === row && tile.col === col);
    const intensity = changedTile?.intensity || ((row + col) % 7) / 10;
    return `<span class="matrix-cell" style="--intensity:${intensity}"></span>`;
  }).join("");

  return `
    <section class="matrix-panel">
      <div class="panel-title-row">
        <h2>Matrix Summary</h2>
        <span>${matrix.shape.join(" x ")} ${matrix.dtype}</span>
      </div>
      <div class="matrix-stats">
        <span>min ${matrix.min}</span>
        <span>max ${matrix.max}</span>
        <span>mean ${matrix.mean}</span>
        <span>NaN ${matrix.nanCount}</span>
      </div>
      <div class="matrix-grid" aria-label="行列タイル差分">${cells}</div>
    </section>
  `;
}

function renderOutput(step, trace) {
  const outputText = [
    trace?.compileOutput ? `compile:\n${trace.compileOutput}` : "",
    trace?.stderr ? `stderr:\n${trace.stderr}` : "",
    trace?.stdout ? `stdout:\n${trace.stdout}` : "",
    !trace?.stdout && !trace?.stderr && !trace?.compileOutput ? step?.output || "stdout はまだありません。" : ""
  ].filter(Boolean).join("\n");

  return `
    <section class="output-panel">
      <div class="panel-title-row">
        <h2>Output</h2>
        <span>${activeLanguageMeta().runLabel}${trace?.status ? ` / ${trace.status}` : ""}</span>
      </div>
      <pre>${escapeHtml(outputText)}</pre>
    </section>
  `;
}

function renderRuntimeState(step, previousStep) {
  return `
    <section class="runtime-state-panel layout-runtime" data-role="runtime-state">
      <svg class="relation-layer" data-role="pointer-layer" aria-hidden="true"></svg>
      ${renderStack(step, previousStep)}
      ${renderHeap(step, previousStep)}
    </section>
  `;
}

function render() {
  const documentState = activeDocument();
  const step = getStep(documentState.trace, documentState.selectedStepIndex);
  const previousStep = documentState.selectedStepIndex > 0
    ? getStep(documentState.trace, documentState.selectedStepIndex - 1)
    : null;

  app.innerHTML = `
    ${renderEditor()}
    <div class="classroom-layout" data-role="classroom-layout">
      ${renderTimeline(documentState.trace, documentState.selectedStepIndex)}
      ${renderSourceTrace(documentState.code, step)}
      ${renderRuntimeState(step, previousStep)}
      ${renderValueChanges(step, previousStep)}
      ${renderMemoryChanges(step, previousStep)}
      ${renderOutput(step, documentState.trace)}
    </div>
  `;

  requestAnimationFrame(() => drawPointerEdges(step));
}

function drawPointerEdges(step) {
  const stage = app.querySelector("[data-role='runtime-state']");
  const layer = app.querySelector("[data-role='pointer-layer']");
  if (!stage || !layer || !step) {
    return;
  }

  const stageRect = stage.getBoundingClientRect();
  layer.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);
  layer.innerHTML = "";

  const documentState = activeDocument();
  const previousStep = documentState.selectedStepIndex > 0
    ? getStep(documentState.trace, documentState.selectedStepIndex - 1)
    : null;
  const changedVariableNames = new Set(compareVariables(previousStep, step).map((change) => change.name));
  const activePointer = state.selectedPointer || state.hoveredPointer;
  const edges = step.pointerEdges.filter((edge) => edge.state !== "out-of-range");

  for (const edge of edges) {
    const source = app.querySelector(`[data-node-id="${edge.from}"]`);
    const target = edge.to ? stage.querySelector(`[data-node-id="${edge.to}"]`) : null;
    if (!source) {
      continue;
    }

    const isHighlighted = activePointer
      ? edge.from === activePointer
      : changedVariableNames.has(edge.from);

    const sourceRect = source.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2 - stageRect.left;
    const startY = sourceRect.top + sourceRect.height / 2 - stageRect.top;

    if (!target) {
      const endX = Math.min(startX + 120, stageRect.width - 24);
      drawLine(layer, edge, startX, startY, endX, startY, isHighlighted);
      drawNullLabel(layer, endX, startY, edge.label);
      continue;
    }

    const targetRect = target.getBoundingClientRect();
    const endX = targetRect.left - stageRect.left;
    const endY = targetRect.top + targetRect.height / 2 - stageRect.top;
    drawLine(layer, edge, startX, startY, endX, endY, isHighlighted);
  }
}

function drawLine(layer, edge, startX, startY, endX, endY, isHighlighted) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const midX = startX + (endX - startX) * 0.5;
  path.setAttribute("d", `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
  path.setAttribute("class", `pointer-path is-${edge.state} ${isHighlighted ? "is-highlighted" : "is-muted"}`);
  path.setAttribute("marker-end", `url(#arrow-${edge.state})`);
  layer.append(createMarkers(), path);
}

function createMarkers() {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  for (const stateName of ["valid", "dangling", "null", "out-of-range"]) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", `arrow-${stateName}`);
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "strokeWidth");
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tip.setAttribute("d", "M0,0 L0,6 L9,3 z");
    tip.setAttribute("class", `pointer-tip is-${stateName}`);
    marker.append(tip);
    defs.append(marker);
  }
  return defs;
}

function drawNullLabel(layer, x, y, label) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", x + 8);
  text.setAttribute("y", y + 4);
  text.setAttribute("class", "null-label");
  text.textContent = label;
  layer.append(text);
}

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-role='code-editor']")) {
    updateActiveCode(event.target.value);
    state.loadedFileName = "";
  }
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-role='file-input']")) {
    void importCodeFile(event.target.files?.[0]);
  }
});

app.addEventListener("pointerover", (event) => {
  const pointerTarget = event.target.closest("[data-hover-pointer]");
  if (pointerTarget) {
    setHoveredPointer(pointerTarget.dataset.hoverPointer);
  }
});

app.addEventListener("pointerout", (event) => {
  if (event.target.closest("[data-hover-pointer]")) {
    setHoveredPointer(null);
  }
});

app.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  if (action === "switch-language") {
    setActiveLanguage(actionTarget.dataset.language);
  }
  if (action === "run-trace") {
    void runActiveTrace();
  }
  if (action === "prev-step") {
    moveStep(-1);
  }
  if (action === "next-step") {
    moveStep(1);
  }
  if (action === "first-step") {
    selectStep(0);
  }
  if (action === "last-step") {
    const documentState = activeDocument();
    selectStep((documentState.trace?.steps.length || 1) - 1);
  }
  if (action === "select-pointer") {
    selectPointer(actionTarget.dataset.pointer);
  }
});

window.addEventListener("resize", () => {
  const documentState = activeDocument();
  drawPointerEdges(getStep(documentState.trace, documentState.selectedStepIndex));
});

render();
