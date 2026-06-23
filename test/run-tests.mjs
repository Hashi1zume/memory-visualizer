import assert from "node:assert/strict";
import { detectLanguageFromFileName } from "../src/fileImport.js";
import { createLanguageState, defaultPrograms } from "../src/samplePrograms.js";
import { generateTrace, getStep } from "../src/traceEngine.js";
import { compareMemoryBlocks, compareVariables } from "../src/stateDiff.js";

function testLanguageBuffersAreIndependent() {
  const state = createLanguageState();
  state.python311.code = "x = [1]";
  state.cpp.code = "int main() { return 1; }";

  assert.equal(state.python311.code, "x = [1]");
  assert.equal(state.cpp.code, "int main() { return 1; }");
  assert.equal(state.c.code, defaultPrograms.c);
}

function testCppPointerRetargeting() {
  const trace = generateTrace("cpp", `
int main() {
  int x = 10;
  int y = 20;
  int* p = &x;
  p = &y;
}
`);

  const firstPointerStep = getStep(trace, 1);
  const secondPointerStep = getStep(trace, 2);

  assert.equal(firstPointerStep.pointerEdges[0].from, "p");
  assert.equal(firstPointerStep.pointerEdges[0].to, "stack-x");
  assert.equal(secondPointerStep.pointerEdges[0].to, "stack-y");
  assert.equal(secondPointerStep.pointerEdges[0].previousTo, "stack-x");
}

function testDanglingPointerDetection() {
  const trace = generateTrace("c", `
#include <stdlib.h>
int main(void) {
  int *buffer = malloc(sizeof(int) * 4);
  free(buffer);
}
`);

  const lastStep = getStep(trace, trace.steps.length - 1);
  assert.equal(lastStep.memoryBlocks.some((block) => block.status === "freed"), true);
  assert.equal(lastStep.pointerEdges.some((edge) => edge.state === "dangling"), true);
}

function testPythonMatrixSummary() {
  const trace = generateTrace("python311", "matrix = [[0 for x in range(8)] for y in range(8)]");
  const lastStep = getStep(trace, trace.steps.length - 1);

  assert.deepEqual(lastStep.matrix.shape, [4096, 4096]);
  assert.equal(lastStep.matrix.changedTiles.length > 0, true);
}

function testStateDiff() {
  const previousStep = {
    frames: [{
      variables: [
        { name: "x", value: "1" },
        { name: "gone", value: "old" }
      ]
    }]
  };
  const currentStep = {
    frames: [{
      variables: [
        { name: "x", value: "2" },
        { name: "y", value: "3" }
      ]
    }],
    memoryBlocks: [
      { id: "heap-1", name: "list", summary: "[1, 2]", status: "live", size: 72 }
    ]
  };

  assert.deepEqual(compareVariables(previousStep, currentStep).map((change) => change.type), [
    "changed",
    "created",
    "removed"
  ]);
  assert.deepEqual(compareMemoryBlocks({ memoryBlocks: [] }, currentStep).map((change) => change.type), [
    "created"
  ]);
}

function testFileLanguageDetection() {
  assert.equal(detectLanguageFromFileName("lesson.py"), "python311");
  assert.equal(detectLanguageFromFileName("main.c"), "c");
  assert.equal(detectLanguageFromFileName("main.cpp"), "cpp");
  assert.equal(detectLanguageFromFileName("main.cc"), "cpp");
  assert.equal(detectLanguageFromFileName("notes.txt"), null);
}

testLanguageBuffersAreIndependent();
testCppPointerRetargeting();
testDanglingPointerDetection();
testPythonMatrixSummary();
testStateDiff();
testFileLanguageDetection();

console.log("All tests passed");
