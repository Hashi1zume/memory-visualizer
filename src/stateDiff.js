export function getFrameVariables(step) {
  return step?.frames?.[0]?.variables || [];
}

export function getVariableKey(variable) {
  return variable.name;
}

export function compareVariables(previousStep, currentStep) {
  const previousVariables = new Map(getFrameVariables(previousStep).map((variable) => [getVariableKey(variable), variable]));
  const currentVariables = new Map(getFrameVariables(currentStep).map((variable) => [getVariableKey(variable), variable]));
  const changes = [];

  for (const [name, currentVariable] of currentVariables) {
    const previousVariable = previousVariables.get(name);
    if (!previousVariable) {
      changes.push({
        name,
        type: "created",
        before: "",
        after: currentVariable.value,
        variable: currentVariable
      });
      continue;
    }

    if (String(previousVariable.value) !== String(currentVariable.value)) {
      changes.push({
        name,
        type: "changed",
        before: previousVariable.value,
        after: currentVariable.value,
        variable: currentVariable
      });
    }
  }

  for (const [name, previousVariable] of previousVariables) {
    if (!currentVariables.has(name)) {
      changes.push({
        name,
        type: "removed",
        before: previousVariable.value,
        after: "",
        variable: previousVariable
      });
    }
  }

  return changes;
}

export function getVariableChangeMap(previousStep, currentStep) {
  return new Map(compareVariables(previousStep, currentStep).map((change) => [change.name, change.type]));
}

export function compareMemoryBlocks(previousStep, currentStep) {
  const previousBlocks = new Map((previousStep?.memoryBlocks || []).map((block) => [block.id, block]));
  const currentBlocks = new Map((currentStep?.memoryBlocks || []).map((block) => [block.id, block]));
  const changes = [];

  for (const [id, currentBlock] of currentBlocks) {
    const previousBlock = previousBlocks.get(id);
    if (!previousBlock) {
      changes.push({
        id,
        type: "created",
        before: "",
        after: currentBlock.summary,
        block: currentBlock
      });
      continue;
    }

    if (
      String(previousBlock.summary) !== String(currentBlock.summary) ||
      String(previousBlock.status) !== String(currentBlock.status) ||
      Number(previousBlock.size) !== Number(currentBlock.size)
    ) {
      changes.push({
        id,
        type: "changed",
        before: `${previousBlock.summary} / ${previousBlock.status} / ${previousBlock.size}B`,
        after: `${currentBlock.summary} / ${currentBlock.status} / ${currentBlock.size}B`,
        block: currentBlock
      });
    }
  }

  for (const [id, previousBlock] of previousBlocks) {
    if (!currentBlocks.has(id)) {
      changes.push({
        id,
        type: "removed",
        before: previousBlock.summary,
        after: "",
        block: previousBlock
      });
    }
  }

  return changes;
}

export function getMemoryChangeMap(previousStep, currentStep) {
  return new Map(compareMemoryBlocks(previousStep, currentStep).map((change) => [change.id, change.type]));
}
