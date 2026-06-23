import { generateTrace } from "./traceEngine.js";

export async function runRealTrace(language, code, stdin = "") {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ language, code, stdin })
  });

  if (!response.ok) {
    throw new Error(`実行APIが失敗しました: ${response.status}`);
  }

  const trace = await response.json();
  if (!trace.steps || trace.steps.length === 0) {
    return generateTrace(language, code);
  }

  return trace;
}
