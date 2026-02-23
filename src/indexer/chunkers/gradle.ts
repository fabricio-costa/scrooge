import { basename } from "node:path";
import type { Chunk, ChunkKind, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";

export const gradleChunker: ChunkerPlugin = {
  id: "gradle",

  supports(filePath: string, language: string): boolean {
    return language === "gradle";
  },

  chunk(filePath: string, content: string): Chunk[] {
    const fileName = basename(filePath).toLowerCase();

    if (fileName.startsWith("settings")) {
      return [makeBlockChunk(filePath, content, 1, content.split("\n").length, "gradle_settings", fileName)];
    }

    return chunkBuildGradle(filePath, content);
  },
};

function chunkBuildGradle(filePath: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split("\n");

  const blockPatterns: Array<{ pattern: RegExp; kind: ChunkKind }> = [
    { pattern: /^plugins\s*\{/m, kind: "gradle_plugins" },
    { pattern: /^android\s*\{/m, kind: "gradle_android" },
    { pattern: /^dependencies\s*\{/m, kind: "gradle_dependencies" },
    { pattern: /^signingConfigs\s*\{/m, kind: "gradle_signing" },
  ];

  for (const { pattern, kind } of blockPatterns) {
    const match = pattern.exec(content);
    if (!match) continue;

    const startOffset = match.index;
    const startLine = content.slice(0, startOffset).split("\n").length;
    const blockContent = extractBlock(content, startOffset);
    if (!blockContent) continue;

    const endLine = startLine + blockContent.split("\n").length - 1;
    chunks.push(makeBlockChunk(filePath, blockContent, startLine, endLine, kind, kind));
  }

  // If no blocks found, return whole file as one chunk
  if (chunks.length === 0) {
    return [makeBlockChunk(filePath, content, 1, lines.length, "gradle_dependencies", basename(filePath))];
  }

  return chunks;
}

function extractBlock(content: string, startOffset: number): string | null {
  let depth = 0;
  let started = false;

  for (let i = startOffset; i < content.length; i++) {
    if (content[i] === "{") {
      depth++;
      started = true;
    } else if (content[i] === "}") {
      depth--;
      if (started && depth === 0) {
        return content.slice(startOffset, i + 1);
      }
    }
  }

  return null;
}

function makeBlockChunk(
  filePath: string,
  text: string,
  startLine: number,
  endLine: number,
  kind: ChunkKind,
  symbolName: string,
): Chunk {
  const contentHash = hashContent(text);
  const id = chunkId(filePath, startLine, endLine, contentHash);

  return {
    id,
    path: filePath,
    language: "gradle",
    kind,
    symbolName,
    startLine,
    endLine,
    textRaw: text,
    textSketch: text.length > 800 ? text.slice(0, 800) + "\n..." : text,
    tags: ["gradle"],
    annotations: [],
    defines: [],
    uses: extractDependencyNames(text),
    contentHash,
  };
}

function extractDependencyNames(text: string): string[] {
  const deps: string[] = [];
  const depRegex = /(?:implementation|api|kapt|ksp|testImplementation|androidTestImplementation)\s*\(?["']([^"']+)["']\)?/g;
  let match: RegExpExecArray | null;
  while ((match = depRegex.exec(text)) !== null) {
    deps.push(match[1]);
  }
  return deps;
}

