import { extname, basename } from "node:path";

export type FileLanguage = "kotlin" | "typescript" | "dart" | "xml" | "gradle" | "other";

export function classifyFile(filePath: string): FileLanguage {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();

  if (ext === ".kt" || ext === ".kts") {
    // .kts that are gradle scripts
    if (name.endsWith(".gradle.kts")) return "gradle";
    return "kotlin";
  }

  if (ext === ".xml") return "xml";

  if (ext === ".gradle" || name === "settings.gradle" || name === "build.gradle") {
    return "gradle";
  }

  if (ext === ".ts" || ext === ".tsx") {
    return "typescript";
  }

  return "other";
}
