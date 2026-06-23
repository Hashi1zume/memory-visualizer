export const languages = [
  {
    id: "python311",
    label: "Python 3.11",
    fileName: "main.py",
    runLabel: "Python trace"
  },
  {
    id: "c",
    label: "C",
    fileName: "main.c",
    runLabel: "C trace"
  },
  {
    id: "cpp",
    label: "C++",
    fileName: "main.cpp",
    runLabel: "C++ trace"
  }
];

export const defaultPrograms = {
  python311: `numbers = [1, 2, 3]
alias = numbers
numbers.append(4)

matrix = [[row * col for col in range(8)] for row in range(8)]
print(alias)`,
  c: `#include <stdlib.h>

int main(void) {
    int x = 10;
    int y = 20;
    int *p = &x;
    p = &y;
    int *buffer = malloc(sizeof(int) * 4);
    free(buffer);
    return 0;
}`,
  cpp: `#include <vector>
#include <string>

int main() {
    int x = 10;
    int y = 20;
    int* p = &x;
    p = &y;
    std::vector<int> values = {1, 2, 3, 4};
    std::string label = "heap";
    return 0;
}`
};

export function createLanguageState() {
  return Object.fromEntries(
    languages.map((language) => [
      language.id,
      {
        code: defaultPrograms[language.id],
        stdin: "",
        trace: null,
        selectedStepIndex: 0
      }
    ])
  );
}
