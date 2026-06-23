const addressBase = {
  stack: 0x1000,
  heap: 0x5000,
  object: 0x9000
};

function formatAddress(value) {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

function createMatrixSummary() {
  return {
    id: "matrix-1",
    name: "matrix",
    shape: [4096, 4096],
    dtype: "float64",
    min: -3.42,
    max: 9.87,
    mean: 0.18,
    nanCount: 0,
    changedTiles: [
      { row: 4, col: 2, intensity: 0.9 },
      { row: 6, col: 7, intensity: 0.72 },
      { row: 10, col: 11, intensity: 0.58 }
    ]
  };
}

function buildStep({ index, line, event, variables, blocks, edges, matrix = null, output = "" }) {
  return {
    index,
    line,
    event,
    frames: [
      {
        id: "frame-main",
        name: "main",
        variables
      }
    ],
    memoryBlocks: blocks,
    pointerEdges: edges,
    matrix,
    output
  };
}

function cloneBlocks(blocks) {
  return blocks.map((block) => ({ ...block }));
}

function cloneEdges(edges) {
  return edges.map((edge) => ({ ...edge }));
}

function parseScalarVariables(code) {
  const matches = [...code.matchAll(/\b(?:int|long|float|double)\s+([a-zA-Z_]\w*)\s*=\s*([^;]+);/g)];
  return matches
    .filter((match) => !match[0].includes("*"))
    .slice(0, 6)
    .map((match, index) => ({
      name: match[1],
      value: match[2].trim(),
      type: "stack",
      address: formatAddress(addressBase.stack + index * 16)
    }));
}

function parsePointerAssignments(code) {
  const declarations = [...code.matchAll(/\b(?:int|long|float|double|char|auto)\s*\*\s*([a-zA-Z_]\w*)\s*=\s*([^;]+);/g)];
  const assignments = [...code.matchAll(/\b([a-zA-Z_]\w*)\s*=\s*(&?[a-zA-Z_]\w*|NULL|nullptr);/g)];
  const pointerNames = new Set(declarations.map((match) => match[1]));
  const pointerEvents = declarations.map((match) => ({
    pointer: match[1],
    targetExpression: match[2].trim()
  }));

  for (const match of assignments) {
    const prefix = code.slice(Math.max(0, match.index - 16), match.index);
    const isDeclarationInitializer = /\b(?:int|long|float|double|char|auto)\s*\*\s*$/.test(prefix);
    if (pointerNames.has(match[1]) && !isDeclarationInitializer) {
      pointerEvents.push({
        pointer: match[1],
        targetExpression: match[2].trim()
      });
    }
  }

  return pointerEvents;
}

function createPointerEdge(pointerName, targetExpression, blocks, stepIndex) {
  if (targetExpression === "NULL" || targetExpression === "nullptr") {
    return {
      id: `${pointerName}-${stepIndex}`,
      from: pointerName,
      to: null,
      label: targetExpression,
      state: "null",
      address: targetExpression,
      previousTo: null
    };
  }

  const targetName = targetExpression.replace(/^&/, "");
  const targetBlock = blocks.find((block) => block.name === targetName);
  return {
    id: `${pointerName}-${stepIndex}`,
    from: pointerName,
    to: targetBlock?.id || targetName,
    label: targetExpression,
    state: targetBlock ? "valid" : "out-of-range",
    address: targetBlock?.address || "unknown",
    previousTo: null
  };
}

function generateNativeTrace(language, code) {
  const scalarVariables = parseScalarVariables(code);
  const fallbackScalars = scalarVariables.length > 0 ? scalarVariables : [
    { name: "x", value: "10", type: "stack", address: formatAddress(addressBase.stack) },
    { name: "y", value: "20", type: "stack", address: formatAddress(addressBase.stack + 16) }
  ];
  const baseBlocks = fallbackScalars.map((variable, index) => ({
    id: `stack-${variable.name}`,
    name: variable.name,
    segment: "stack",
    address: variable.address,
    size: 4,
    status: "live",
    summary: `${variable.name} = ${variable.value}`,
    order: index
  }));

  const pointerEvents = parsePointerAssignments(code);
  const effectivePointerEvents = pointerEvents.length > 0 ? pointerEvents : [
    { pointer: "p", targetExpression: "&x" },
    { pointer: "p", targetExpression: "&y" }
  ];

  const steps = [];
  let currentEdges = [];
  let currentBlocks = cloneBlocks(baseBlocks);

  steps.push(buildStep({
    index: 0,
    line: 1,
    event: `${language === "cpp" ? "C++" : "C"} 実行を開始`,
    variables: fallbackScalars,
    blocks: currentBlocks,
    edges: []
  }));

  effectivePointerEvents.forEach((pointerEvent, eventIndex) => {
    const previousEdge = currentEdges.find((edge) => edge.from === pointerEvent.pointer);
    const nextEdge = createPointerEdge(pointerEvent.pointer, pointerEvent.targetExpression, currentBlocks, eventIndex + 1);
    nextEdge.previousTo = previousEdge?.to || null;
    currentEdges = currentEdges.filter((edge) => edge.from !== pointerEvent.pointer).concat(nextEdge);

    steps.push(buildStep({
      index: steps.length,
      line: eventIndex + 4,
      event: `${pointerEvent.pointer} の参照先を ${pointerEvent.targetExpression} に変更`,
      variables: fallbackScalars.concat({
        name: pointerEvent.pointer,
        value: nextEdge.address,
        type: "pointer",
        address: formatAddress(addressBase.stack + 128 + eventIndex * 16)
      }),
      blocks: cloneBlocks(currentBlocks),
      edges: cloneEdges(currentEdges)
    }));
  });

  if (/malloc|new\s/.test(code)) {
    const heapBlock = {
      id: "heap-buffer",
      name: language === "cpp" ? "values" : "buffer",
      segment: "heap",
      address: formatAddress(addressBase.heap),
      size: language === "cpp" ? 24 : 16,
      status: "live",
      summary: language === "cpp" ? "std::vector<int> size=4" : "int[4]",
      order: currentBlocks.length
    };
    currentBlocks = currentBlocks.concat(heapBlock);
    currentEdges = currentEdges.concat({
      id: `heap-edge-${steps.length}`,
      from: heapBlock.name,
      to: heapBlock.id,
      label: heapBlock.address,
      state: "valid",
      address: heapBlock.address,
      previousTo: null
    });

    steps.push(buildStep({
      index: steps.length,
      line: 8,
      event: `heap に ${heapBlock.summary} を確保`,
      variables: fallbackScalars.concat({
        name: heapBlock.name,
        value: heapBlock.address,
        type: "pointer",
        address: formatAddress(addressBase.stack + 192)
      }),
      blocks: cloneBlocks(currentBlocks),
      edges: cloneEdges(currentEdges)
    }));
  }

  if (/free\s*\(|delete\s/.test(code)) {
    currentBlocks = currentBlocks.map((block) => block.segment === "heap" ? { ...block, status: "freed" } : block);
    currentEdges = currentEdges.map((edge) => edge.to === "heap-buffer" ? { ...edge, state: "dangling" } : edge);
    steps.push(buildStep({
      index: steps.length,
      line: 9,
      event: "解放済みメモリを指すポインタを検出",
      variables: fallbackScalars,
      blocks: cloneBlocks(currentBlocks),
      edges: cloneEdges(currentEdges)
    }));
  }

  return {
    id: `${language}-${Date.now()}`,
    language,
    status: "completed",
    totalSteps: steps.length,
    steps,
    limits: {
      executionTimeMs: 60000,
      maxEvents: 1000000,
      initialPayloadMb: 5
    }
  };
}

function generatePythonTrace(code) {
  const hasMatrix = /matrix|range\s*\(/.test(code);
  const steps = [
    buildStep({
      index: 0,
      line: 1,
      event: "list オブジェクトを作成",
      variables: [
        { name: "numbers", value: "obj-1", type: "reference", address: formatAddress(addressBase.object) }
      ],
      blocks: [
        {
          id: "obj-1",
          name: "list",
          segment: "heap",
          address: formatAddress(addressBase.object),
          size: 88,
          status: "live",
          summary: "[1, 2, 3]",
          order: 0
        }
      ],
      edges: [
        {
          id: "numbers-0",
          from: "numbers",
          to: "obj-1",
          label: "id(obj)",
          state: "valid",
          address: formatAddress(addressBase.object),
          previousTo: null
        }
      ]
    }),
    buildStep({
      index: 1,
      line: 2,
      event: "alias が同じ list を参照",
      variables: [
        { name: "numbers", value: "obj-1", type: "reference", address: formatAddress(addressBase.object) },
        { name: "alias", value: "obj-1", type: "reference", address: formatAddress(addressBase.object + 16) }
      ],
      blocks: [
        {
          id: "obj-1",
          name: "list",
          segment: "heap",
          address: formatAddress(addressBase.object),
          size: 88,
          status: "live",
          summary: "[1, 2, 3]",
          order: 0
        }
      ],
      edges: [
        {
          id: "numbers-1",
          from: "numbers",
          to: "obj-1",
          label: "id(obj)",
          state: "valid",
          address: formatAddress(addressBase.object),
          previousTo: null
        },
        {
          id: "alias-1",
          from: "alias",
          to: "obj-1",
          label: "id(obj)",
          state: "valid",
          address: formatAddress(addressBase.object),
          previousTo: null
        }
      ]
    }),
    buildStep({
      index: 2,
      line: 3,
      event: "list を破壊的に更新",
      variables: [
        { name: "numbers", value: "obj-1", type: "reference", address: formatAddress(addressBase.object) },
        { name: "alias", value: "obj-1", type: "reference", address: formatAddress(addressBase.object + 16) }
      ],
      blocks: [
        {
          id: "obj-1",
          name: "list",
          segment: "heap",
          address: formatAddress(addressBase.object),
          size: 120,
          status: "live",
          summary: "[1, 2, 3, 4]",
          order: 0
        }
      ],
      edges: [
        {
          id: "numbers-2",
          from: "numbers",
          to: "obj-1",
          label: "id(obj)",
          state: "valid",
          address: formatAddress(addressBase.object),
          previousTo: null
        },
        {
          id: "alias-2",
          from: "alias",
          to: "obj-1",
          label: "id(obj)",
          state: "valid",
          address: formatAddress(addressBase.object),
          previousTo: null
        }
      ],
      matrix: hasMatrix ? createMatrixSummary() : null,
      output: "[1, 2, 3, 4]"
    })
  ];

  return {
    id: `python311-${Date.now()}`,
    language: "python311",
    status: "completed",
    totalSteps: steps.length,
    steps,
    limits: {
      executionTimeMs: 60000,
      maxEvents: 1000000,
      initialPayloadMb: 5
    }
  };
}

export function generateTrace(language, code) {
  if (language === "python311") {
    return generatePythonTrace(code);
  }

  return generateNativeTrace(language, code);
}

export function getStep(trace, index) {
  if (!trace || trace.steps.length === 0) {
    return null;
  }

  return trace.steps[Math.min(Math.max(index, 0), trace.steps.length - 1)];
}
