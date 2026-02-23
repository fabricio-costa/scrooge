import { basename } from "node:path";
import type { Chunk, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";

const MAX_CHUNK_LINES = 100;

export const genericChunker: ChunkerPlugin = {
  id: "generic",

  supports(): boolean {
    return true; // Fallback, accepts everything
  },

  chunk(filePath: string, content: string): Chunk[] {
    const lines = content.split("\n");

    // Small files: one chunk
    if (lines.length <= MAX_CHUNK_LINES) {
      return [makeChunk(filePath, content, 1, lines.length)];
    }

    // Try to split on function/block boundaries
    return splitOnBoundaries(filePath, lines);
  },
};

function splitOnBoundaries(filePath: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const linesSoFar = i - chunkStart + 1;

    // Split at function-like boundaries when chunk is getting large
    if (linesSoFar >= MAX_CHUNK_LINES && isBlockBoundary(line)) {
      const text = lines.slice(chunkStart, i).join("\n");
      if (text.trim()) {
        chunks.push(makeChunk(filePath, text, chunkStart + 1, i));
      }
      chunkStart = i;
    }
  }

  // Remaining lines
  if (chunkStart < lines.length) {
    const text = lines.slice(chunkStart).join("\n");
    if (text.trim()) {
      chunks.push(makeChunk(filePath, text, chunkStart + 1, lines.length));
    }
  }

  return chunks;
}

function isBlockBoundary(line: string): boolean {
  const trimmed = line.trim();
  // Empty lines, function declarations, class declarations
  return (
    trimmed === "" ||
    /^(fun |class |object |interface |enum |sealed |data |abstract |open |private |protected |internal |public |def |function |const |export |import )/.test(trimmed)
  );
}

function makeChunk(filePath: string, text: string, startLine: number, endLine: number): Chunk {
  const contentHash = hashContent(text);
  const id = chunkId(filePath, startLine, endLine, contentHash);

  // Try to extract a symbol name from the first meaningful line
  const firstLine = text.split("\n").find((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))?.trim() ?? "";
  const symbolMatch = firstLine.match(/(?:fun|class|object|interface|function|def|const|export)\s+(\w+)/);

  return {
    id,
    path: filePath,
    language: "other",
    kind: "generic_block",
    symbolName: symbolMatch?.[1] ?? basename(filePath),
    startLine,
    endLine,
    textRaw: text,
    textSketch: text.length > 800 ? text.slice(0, 800) + "\n..." : text,
    tags: [],
    annotations: [],
    defines: [],
    uses: [],
    contentHash,
  };
}

