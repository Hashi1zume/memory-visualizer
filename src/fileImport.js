export function detectLanguageFromFileName(fileName) {
  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith(".py")) {
    return "python311";
  }
  if (normalizedName.endsWith(".c")) {
    return "c";
  }
  if (normalizedName.endsWith(".cc") || normalizedName.endsWith(".cpp") || normalizedName.endsWith(".cxx")) {
    return "cpp";
  }
  return null;
}

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("ファイルを読み込めませんでした。")));
    reader.readAsText(file);
  });
}
