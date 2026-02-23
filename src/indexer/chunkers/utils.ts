import { createHash } from "node:crypto";

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function chunkId(filePath: string, startLine: number, endLine: number, contentHash: string): string {
  const input = `${filePath}:${startLine}:${endLine}:${contentHash}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}
