import { estimateTokens, truncateToTokenBudget } from "../utils/tokens.js";
import type { Chunk } from "./chunkers/types.js";

const MAX_SKETCH_TOKENS = 200;

/**
 * Generate a compressed sketch from a raw chunk.
 * The sketch preserves the signature, documentation, and key structural elements
 * while removing implementation details.
 */
export function generateSketch(chunk: Chunk): string {
  const { kind, textRaw, signature, symbolName, annotations } = chunk;

  const parts: string[] = [];

  // Annotations
  if (annotations.length > 0) {
    parts.push(annotations.join(" "));
  }

  // Signature or first meaningful line
  if (signature) {
    parts.push(signature);
  }

  // Extract KDoc/Javadoc if present
  const docComment = extractDocComment(textRaw);
  if (docComment) {
    parts.push(docComment);
  }

  // Kind-specific sketch content
  switch (kind) {
    case "class":
    case "object":
    case "viewmodel":
      parts.push(extractClassSkeleton(textRaw));
      break;
    case "function":
    case "method":
    case "composable":
    case "di_provider":
      // For functions, signature + doc is usually enough
      if (!signature) {
        parts.push(extractFunctionSignature(textRaw));
      }
      break;
    case "api_interface":
    case "dao":
      parts.push(extractInterfaceMethods(textRaw));
      break;
    case "entity":
      parts.push(extractEntityFields(textRaw));
      break;
    case "manifest_component":
    case "nav_destination":
    case "layout":
    case "values":
      // XML chunks: keep as-is but truncate
      break;
    case "gradle_plugins":
    case "gradle_android":
    case "gradle_dependencies":
    case "gradle_signing":
    case "gradle_settings":
      // Gradle: keep as-is but truncate
      break;
    default:
      break;
  }

  let sketch = parts.filter(Boolean).join("\n");

  // Ensure sketch fits within token budget
  if (estimateTokens(sketch) > MAX_SKETCH_TOKENS) {
    sketch = truncateToTokenBudget(sketch, MAX_SKETCH_TOKENS);
  }

  // If sketch is empty, fall back to truncated raw
  if (!sketch.trim()) {
    sketch = truncateToTokenBudget(textRaw, MAX_SKETCH_TOKENS);
  }

  return sketch;
}

function extractDocComment(text: string): string {
  const match = text.match(/\/\*\*[\s\S]*?\*\//);
  if (match) return match[0];

  // Single-line doc comments
  const lines = text.split("\n");
  const docLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("///") || trimmed.startsWith("//!")) {
      docLines.push(trimmed);
    } else if (docLines.length > 0) {
      break;
    }
  }
  return docLines.join("\n");
}

function extractClassSkeleton(text: string): string {
  const lines = text.split("\n");
  const skeleton: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Keep property declarations
    if (trimmed.startsWith("val ") || trimmed.startsWith("var ") || trimmed.startsWith("private val ") || trimmed.startsWith("private var ")) {
      skeleton.push("  " + trimmed);
    }
    // Keep function signatures (just the signature, not the body)
    if (/^\s*(override\s+)?(suspend\s+)?(fun\s+)/.test(line)) {
      const sig = trimmed.replace(/\{[\s\S]*$/, "").trim();
      skeleton.push("  " + sig);
    }
  }

  return skeleton.join("\n");
}

function extractFunctionSignature(text: string): string {
  const lines = text.split("\n");
  for (const line of lines) {
    if (/\bfun\s+/.test(line)) {
      return line.trim().replace(/\{[\s\S]*$/, "").trim();
    }
  }
  return lines[0]?.trim() ?? "";
}

function extractInterfaceMethods(text: string): string {
  const lines = text.split("\n");
  const methods: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s*(@\w+|suspend\s+fun|fun\s+)/.test(line) || trimmed.startsWith("@GET") || trimmed.startsWith("@POST") || trimmed.startsWith("@PUT") || trimmed.startsWith("@DELETE") || trimmed.startsWith("@Query")) {
      methods.push("  " + trimmed);
    }
  }
  return methods.join("\n");
}

function extractEntityFields(text: string): string {
  const lines = text.split("\n");
  const fields: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("val ") || trimmed.startsWith("var ") || trimmed.startsWith("@ColumnInfo") || trimmed.startsWith("@PrimaryKey")) {
      fields.push("  " + trimmed);
    }
  }
  return fields.join("\n");
}
