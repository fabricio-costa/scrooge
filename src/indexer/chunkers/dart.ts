import Parser from "tree-sitter";
import DartLanguage from "tree-sitter-dart";
import type { Chunk, ChunkKind, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";
import { generateSketch } from "../sketcher.js";

const parser = new Parser();
parser.setLanguage(DartLanguage);

const MAX_CLASS_LINES = 400;

export const dartChunker: ChunkerPlugin = {
  id: "dart",

  supports(_filePath: string, language: string): boolean {
    return language === "dart";
  },

  chunk(filePath: string, content: string): Chunk[] {
    const tree = parser.parse(content);
    const lines = content.split("\n");
    const imports = extractImports(tree.rootNode);
    const chunks: Chunk[] = [];

    visitNode(tree.rootNode, filePath, lines, imports, chunks);

    return chunks;
  },
};

function visitNode(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
): void {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const commentStartLine = getPrecedingCommentStart(node, i);

    switch (child.type) {
      case "class_definition":
        processClass(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      case "enum_declaration":
        processEnum(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      case "mixin_declaration":
        processMixin(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      case "extension_declaration":
        processExtension(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      case "type_alias":
        processTypeAlias(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      case "function_signature":
      case "function_definition":
        processFunction(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      case "initialized_variable_definition":
      case "static_final_declaration":
        processTopLevelVariable(child, filePath, lines, imports, chunks, commentStartLine);
        break;
      default:
        break;
    }
  }
}

function getPrecedingCommentStart(parent: Parser.SyntaxNode, index: number): number | undefined {
  if (index <= 0) return undefined;
  const prev = parent.children[index - 1];
  // Dart doc comments: /** ... */ or /// lines (documentation_comment node)
  if (prev.type === "documentation_comment" || prev.type === "comment") {
    if (prev.text.startsWith("/**") || prev.text.startsWith("///")) {
      return prev.startPosition.row;
    }
  }
  return undefined;
}

function processClass(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const lineCount = endLine - startLine + 1;
  const signature = extractSignature(node, lines);
  const annotations = extractAnnotations(node);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const baseChunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "class",
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations,
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  baseChunk.textSketch = generateSketch(baseChunk);

  if (lineCount > MAX_CLASS_LINES) {
    const methodChunks = extractMethodChunks(node, filePath, lines, fqname, imports);
    chunks.push(baseChunk, ...methodChunks);
  } else {
    chunks.push(baseChunk);
  }
}

function processEnum(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "enum",
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: extractAnnotations(node),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  chunk.textSketch = generateSketch(chunk);
  chunks.push(chunk);
}

function processMixin(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "mixin",
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: extractAnnotations(node),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  chunk.textSketch = generateSketch(chunk);
  chunks.push(chunk);
}

function processExtension(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  // Extension name is optional in Dart: "extension StringExt on String {}" or "extension on String {}"
  const name = findChildByType(node, "identifier")?.text ?? "anonymous";

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "extension",
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: extractAnnotations(node),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  chunk.textSketch = generateSketch(chunk);
  chunks.push(chunk);
}

function processTypeAlias(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  const name = findChildByType(node, "type_identifier")?.text
    ?? findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "type_alias",
    symbolName: name,
    symbolFqname: fqname,
    signature: textRaw.trim(),
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: [],
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  chunk.textSketch = generateSketch(chunk);
  chunks.push(chunk);
}

function processFunction(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "function",
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: extractAnnotations(node),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  chunk.textSketch = generateSketch(chunk);
  chunks.push(chunk);
}

function processTopLevelVariable(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  commentStartLine?: number,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const tags = classifyTags(textRaw, imports);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "dart",
    kind: "function",
    symbolName: name,
    symbolFqname: fqname,
    signature: textRaw.trim(),
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: extractAnnotations(node),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash: contentHash_,
  };

  chunk.textSketch = generateSketch(chunk);
  chunks.push(chunk);
}

function extractMethodChunks(
  classNode: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  classFqname: string,
  imports: string[],
): Chunk[] {
  const body = findChildByType(classNode, "class_body");
  if (!body) return [];

  const chunks: Chunk[] = [];
  for (const child of body.children) {
    if (child.type === "method_signature" || child.type === "function_definition"
        || child.type === "getter_signature" || child.type === "setter_signature") {
      const name = findChildByType(child, "identifier")?.text;
      if (!name) continue;

      const fqname = `${classFqname}.${name}`;
      const startLine = child.startPosition.row + 1;
      const endLine = child.endPosition.row + 1;
      const textRaw = getNodeText(child, lines);
      const signature = extractSignature(child, lines);
      const tags = classifyTags(textRaw, imports);

      const contentHash_ = hashContent(textRaw);
      const id = chunkId(filePath, startLine, endLine, contentHash_);

      const chunk: Chunk = {
        id,
        path: filePath,
        language: "dart",
        kind: "method",
        symbolName: name,
        symbolFqname: fqname,
        signature,
        startLine,
        endLine,
        textRaw,
        textSketch: "",
        tags,
        annotations: extractAnnotations(child),
        defines: [fqname],
        uses: extractUses(textRaw, imports),
        contentHash: contentHash_,
      };

      chunk.textSketch = generateSketch(chunk);
      chunks.push(chunk);
    }
  }

  return chunks;
}

// --- Helpers ---

function extractImports(root: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  for (const child of root.children) {
    if (child.type === "import_or_export") {
      // Find the string literal with the package path
      for (const sub of child.children) {
        if (sub.type === "library_import" || sub.type === "library_export") {
          for (const part of sub.children) {
            if (part.type === "configurable_uri") {
              const str = findChildByType(part, "string_literal")
                ?? findChildByType(part, "uri");
              if (str) {
                const path = str.text.replace(/['"]/g, "");
                if (path) imports.push(path);
              }
            }
          }
        }
      }
    }
  }
  return imports;
}

function extractAnnotations(node: Parser.SyntaxNode): string[] {
  const annotations: string[] = [];
  for (const child of node.children) {
    if (child.type === "annotation" || child.type === "marker_annotation") {
      annotations.push(child.text);
    }
  }
  return annotations;
}

function extractSignature(node: Parser.SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  for (let i = startLine; i <= Math.min(startLine + 5, lines.length - 1); i++) {
    const line = lines[i];
    if (line.includes("{") || line.includes("=>")) {
      return lines
        .slice(startLine, i + 1)
        .join("\n")
        .replace(/[{][\s\S]*$/, "")
        .replace(/=>[\s\S]*$/, "")
        .trim();
    }
  }
  return lines[startLine]?.trim() ?? "";
}

function extractUses(text: string, imports: string[]): string[] {
  const uses: string[] = [];
  for (const imp of imports) {
    if (text.includes(imp)) {
      uses.push(imp);
    }
  }
  return [...new Set(uses)];
}

function classifyTags(text: string, imports: string[]): string[] {
  const tags: string[] = [];
  // Flutter
  if (imports.some(i => i.includes("package:flutter"))) tags.push("flutter");
  if (/extends\s+Stateless\w*Widget/.test(text)) tags.push("widget");
  if (/extends\s+Stateful\w*Widget/.test(text)) tags.push("widget");
  if (/extends\s+State</.test(text)) tags.push("state");
  // State management
  if (imports.some(i => i.includes("riverpod"))) tags.push("riverpod");
  if (imports.some(i => i.includes("bloc"))) tags.push("bloc");
  if (imports.some(i => i.includes("provider"))) tags.push("provider");
  // Code gen
  if (text.includes("@freezed")) tags.push("freezed");
  if (text.includes("@JsonSerializable")) tags.push("json_serializable");
  // Async
  if (/\b(async|await|Future<)\b/.test(text)) tags.push("async");
  // Test
  if (/\b(test|testWidgets|group|expect)\b/.test(text)) tags.push("test");
  return [...new Set(tags)];
}

function findChildByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === type) return child;
  }
  return null;
}

function getNodeText(node: Parser.SyntaxNode, lines: string[]): string {
  return lines.slice(node.startPosition.row, node.endPosition.row + 1).join("\n");
}
