import Parser from "tree-sitter";
import PythonLanguage from "tree-sitter-python";
import type { Chunk, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";
import { generateSketch } from "../sketcher.js";

const parser = new Parser();
parser.setLanguage(PythonLanguage);

const MAX_CLASS_LINES = 400;

export const pythonChunker: ChunkerPlugin = {
  id: "python",

  supports(_filePath: string, language: string): boolean {
    return language === "python";
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
  for (const child of node.children) {
    switch (child.type) {
      case "class_definition":
        processClass(child, filePath, lines, imports, chunks, []);
        break;
      case "function_definition":
        processFunction(child, filePath, lines, imports, chunks, [], null);
        break;
      case "decorated_definition":
        processDecorated(child, filePath, lines, imports, chunks);
        break;
      default:
        break;
    }
  }
}

function processDecorated(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
): void {
  const decorators = extractDecorators(node);
  const definition = node.children.find(
    (c) => c.type === "class_definition" || c.type === "function_definition",
  );
  if (!definition) return;

  if (definition.type === "class_definition") {
    processClass(definition, filePath, lines, imports, chunks, decorators, node);
  } else {
    processFunction(definition, filePath, lines, imports, chunks, decorators, node);
  }
}

function processClass(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  decorators: string[],
  decoratedParent?: Parser.SyntaxNode,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const outerNode = decoratedParent ?? node;
  const startLine = outerNode.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = getNodeText(outerNode, node, lines);
  const lineCount = endLine - startLine + 1;
  const signature = extractClassSignature(node, lines);
  const isDataclass = decorators.some((d) => d.startsWith("@dataclass"));
  const kind = isDataclass ? "dataclass" : "class";
  const tags = classifyTags(textRaw, imports, decorators);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const baseChunk: Chunk = {
    id,
    path: filePath,
    language: "python",
    kind,
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: decorators,
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

function processFunction(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  decorators: string[],
  decoratedParent: Parser.SyntaxNode | null,
): void {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return;

  const fqname = `${filePath}.${name}`;
  const outerNode = decoratedParent ?? node;
  const startLine = outerNode.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = getNodeText(outerNode, node, lines);
  const signature = extractFuncSignature(node, lines);
  const tags = classifyTags(textRaw, imports, decorators);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "python",
    kind: "function",
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags,
    annotations: decorators,
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
  const body = findChildByType(classNode, "block");
  if (!body) return [];

  const chunks: Chunk[] = [];
  for (const child of body.children) {
    let funcNode: Parser.SyntaxNode | undefined;
    let decorators: string[] = [];
    let outerNode: Parser.SyntaxNode;

    if (child.type === "function_definition") {
      funcNode = child;
      outerNode = child;
    } else if (child.type === "decorated_definition") {
      decorators = extractDecorators(child);
      funcNode = child.children.find((c) => c.type === "function_definition");
      outerNode = child;
    } else {
      continue;
    }

    if (!funcNode) continue;
    const name = findChildByType(funcNode, "identifier")?.text;
    if (!name) continue;

    const fqname = `${classFqname}.${name}`;
    const startLine = outerNode!.startPosition.row + 1;
    const endLine = funcNode.endPosition.row + 1;
    const textRaw = getNodeText(outerNode!, funcNode, lines);
    const signature = extractFuncSignature(funcNode, lines);
    const tags = classifyTags(textRaw, imports, decorators);

    const contentHash_ = hashContent(textRaw);
    const id = chunkId(filePath, startLine, endLine, contentHash_);

    const chunk: Chunk = {
      id,
      path: filePath,
      language: "python",
      kind: "method",
      symbolName: name,
      symbolFqname: fqname,
      signature,
      startLine,
      endLine,
      textRaw,
      textSketch: "",
      tags,
      annotations: decorators,
      defines: [fqname],
      uses: extractUses(textRaw, imports),
      contentHash: contentHash_,
    };

    chunk.textSketch = generateSketch(chunk);
    chunks.push(chunk);
  }

  return chunks;
}

// --- Helpers ---

function extractImports(root: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  for (const child of root.children) {
    if (child.type === "import_statement") {
      // import os, import math
      const name = findChildByType(child, "dotted_name");
      if (name) imports.push(name.text);
    } else if (child.type === "import_from_statement") {
      // from typing import List, Optional
      const module = findChildByType(child, "dotted_name");
      if (module) {
        imports.push(module.text);
        // Track both "module.Symbol" and bare "Symbol" for each imported name
        for (const c of child.children) {
          if (c.type === "dotted_name" && c !== module) {
            imports.push(`${module.text}.${c.text}`);
            imports.push(c.text);
          }
        }
      }
    }
  }
  return [...new Set(imports)];
}

function extractDecorators(node: Parser.SyntaxNode): string[] {
  const decorators: string[] = [];
  for (const child of node.children) {
    if (child.type === "decorator") {
      decorators.push(child.text.trim());
    }
  }
  return decorators;
}

function extractClassSignature(node: Parser.SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  for (let i = startLine; i <= Math.min(startLine + 5, lines.length - 1); i++) {
    const line = lines[i];
    if (line.includes(":")) {
      return lines
        .slice(startLine, i + 1)
        .join("\n")
        .replace(/:[\s\S]*$/, ":")
        .trim();
    }
  }
  return lines[startLine]?.trim() ?? "";
}

function extractFuncSignature(node: Parser.SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  for (let i = startLine; i <= Math.min(startLine + 5, lines.length - 1); i++) {
    const line = lines[i];
    if (line.includes(":") && (line.includes(")") || line.trimEnd().endsWith(":"))) {
      return lines
        .slice(startLine, i + 1)
        .join("\n")
        .replace(/:[\s]*$/, ":")
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

function classifyTags(text: string, imports: string[], decorators: string[]): string[] {
  const tags: string[] = [];

  if (imports.some((i) => i.startsWith("django"))) tags.push("django");
  if (imports.some((i) => i.startsWith("fastapi"))) tags.push("fastapi");
  if (decorators.some((d) => d.startsWith("@dataclass"))) tags.push("dataclass");
  if (imports.some((i) => i.includes("abc")) || /\bABC\b/.test(text)) tags.push("abc");
  if (/\basync\s+def\b/.test(text)) tags.push("async");
  if (/\bdef\s+test_/.test(text) || decorators.some((d) => d.includes("pytest"))) tags.push("test");
  if (decorators.some((d) => d === "@property")) tags.push("property");
  if (imports.some((i) => i.startsWith("pydantic"))) tags.push("pydantic");

  return [...new Set(tags)];
}

function findChildByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === type) return child;
  }
  return null;
}

function getNodeText(
  outerNode: Parser.SyntaxNode,
  innerNode: Parser.SyntaxNode,
  lines: string[],
): string {
  return lines.slice(outerNode.startPosition.row, innerNode.endPosition.row + 1).join("\n");
}
