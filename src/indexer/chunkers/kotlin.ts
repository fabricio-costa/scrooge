import Parser from "tree-sitter";
import Kotlin from "tree-sitter-kotlin";
import type { Chunk, ChunkKind, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";
import { generateSketch } from "../sketcher.js";

const parser = new Parser();
parser.setLanguage(Kotlin);

const MAX_CLASS_LINES = 400;

export const kotlinChunker: ChunkerPlugin = {
  id: "kotlin",

  supports(filePath: string, language: string): boolean {
    return language === "kotlin";
  },

  chunk(filePath: string, content: string): Chunk[] {
    const tree = parser.parse(content);
    const lines = content.split("\n");
    const chunks: Chunk[] = [];
    const packageName = extractPackageName(tree.rootNode);
    const imports = extractImports(tree.rootNode);

    visitNode(tree.rootNode, filePath, lines, packageName, imports, chunks);

    return chunks;
  },
};

function visitNode(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  packageName: string,
  imports: string[],
  chunks: Chunk[],
  parentClass?: string,
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "class_declaration":
      case "interface_declaration":
      case "object_declaration": {
        const chunk = processClass(child, filePath, lines, packageName, imports, parentClass);
        if (chunk) {
          chunks.push(...chunk);
        }
        break;
      }
      case "function_declaration": {
        if (!parentClass) {
          // Top-level function
          const chunk = processFunction(child, filePath, lines, packageName, imports);
          if (chunk) chunks.push(chunk);
        }
        break;
      }
      default:
        // Recurse for things inside companion objects, etc.
        if (child.childCount > 0 && !["class_body", "function_body"].includes(child.type)) {
          visitNode(child, filePath, lines, packageName, imports, chunks, parentClass);
        }
        break;
    }
  }
}

function processClass(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  packageName: string,
  imports: string[],
  parentClass?: string,
): Chunk[] | null {
  const name = findChildByType(node, "type_identifier")?.text
    ?? findChildByType(node, "simple_identifier")?.text;
  if (!name) return null;

  const fqname = packageName ? `${packageName}.${name}` : name;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = getNodeText(node, lines);
  const lineCount = endLine - startLine + 1;
  const annotations = extractAnnotations(node);
  const tags = classifyTags(node, annotations, textRaw);
  const kind = classifyClassKind(node, annotations, textRaw);
  const signature = extractClassSignature(node, lines);

  const contentHash = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash);

  const baseChunk: Chunk = {
    id,
    path: filePath,
    language: "kotlin",
    kind,
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "", // Will be filled by sketcher
    tags,
    annotations: annotations.map((a) => a.text),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash,
  };

  baseChunk.textSketch = generateSketch(baseChunk);

  // If class is too large, also create per-method chunks
  if (lineCount > MAX_CLASS_LINES) {
    const methodChunks = extractMethodChunks(node, filePath, lines, packageName, fqname, imports);
    return [baseChunk, ...methodChunks];
  }

  return [baseChunk];
}

function processFunction(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  packageName: string,
  imports: string[],
): Chunk | null {
  const name = findChildByType(node, "simple_identifier")?.text;
  if (!name) return null;

  const fqname = packageName ? `${packageName}.${name}` : name;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = getNodeText(node, lines);
  const annotations = extractAnnotations(node);
  const kind = classifyFunctionKind(annotations);
  const signature = extractFunctionSignature(node, lines);

  const contentHash = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "kotlin",
    kind,
    symbolName: name,
    symbolFqname: fqname,
    signature,
    startLine,
    endLine,
    textRaw,
    textSketch: "",
    tags: classifyFunctionTags(annotations),
    annotations: annotations.map((a) => a.text),
    defines: [fqname],
    uses: extractUses(textRaw, imports),
    contentHash,
  };

  chunk.textSketch = generateSketch(chunk);
  return chunk;
}

function extractMethodChunks(
  classNode: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  packageName: string,
  classFqname: string,
  imports: string[],
): Chunk[] {
  const body = findChildByType(classNode, "class_body");
  if (!body) return [];

  const chunks: Chunk[] = [];
  for (const child of body.children) {
    if (child.type === "function_declaration") {
      const name = findChildByType(child, "simple_identifier")?.text;
      if (!name) continue;

      const fqname = `${classFqname}.${name}`;
      const startLine = child.startPosition.row + 1;
      const endLine = child.endPosition.row + 1;
      const textRaw = getNodeText(child, lines);
      const annotations = extractAnnotations(child);
      const kind = classifyFunctionKind(annotations);
      const signature = extractFunctionSignature(child, lines);

      const contentHash = hashContent(textRaw);
      const id = chunkId(filePath, startLine, endLine, contentHash);

      const chunk: Chunk = {
        id,
        path: filePath,
        language: "kotlin",
        kind,
        symbolName: name,
        symbolFqname: fqname,
        signature,
        startLine,
        endLine,
        textRaw,
        textSketch: "",
        tags: classifyFunctionTags(annotations),
        annotations: annotations.map((a) => a.text),
        defines: [fqname],
        uses: extractUses(textRaw, imports),
        contentHash,
      };

      chunk.textSketch = generateSketch(chunk);
      chunks.push(chunk);
    }
  }

  return chunks;
}

// --- Helpers ---

function extractPackageName(root: Parser.SyntaxNode): string {
  for (const child of root.children) {
    if (child.type === "package_header") {
      const ident = findChildByType(child, "identifier");
      return ident?.text ?? "";
    }
  }
  return "";
}

function extractImports(root: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  for (const child of root.children) {
    if (child.type === "import_list") {
      for (const imp of child.children) {
        if (imp.type === "import_header") {
          const ident = findChildByType(imp, "identifier");
          if (ident) imports.push(ident.text);
        }
      }
    }
  }
  return imports;
}

function extractAnnotations(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const annotations: Parser.SyntaxNode[] = [];
  // Check modifiers
  const modifiers = findChildByType(node, "modifiers");
  if (modifiers) {
    for (const child of modifiers.children) {
      if (child.type === "annotation") {
        annotations.push(child);
      }
    }
  }
  // Also check direct annotation children
  for (const child of node.children) {
    if (child.type === "annotation") {
      annotations.push(child);
    }
  }
  return annotations;
}

function classifyClassKind(
  node: Parser.SyntaxNode,
  annotations: Parser.SyntaxNode[],
  text: string,
): ChunkKind {
  if (node.type === "object_declaration") return "object";

  const annotationTexts = annotations.map((a) => a.text);
  if (annotationTexts.some((a) => a.includes("HiltViewModel")) || text.includes(": ViewModel(")) {
    return "viewmodel";
  }
  if (annotationTexts.some((a) => a.includes("Dao"))) return "dao";
  if (annotationTexts.some((a) => a.includes("Entity"))) return "entity";
  if (text.includes("interface ") && annotationTexts.some((a) => a.includes("GET") || a.includes("POST") || a.includes("PUT") || a.includes("DELETE"))) {
    return "api_interface";
  }

  return "class";
}

function classifyFunctionKind(annotations: Parser.SyntaxNode[]): ChunkKind {
  const texts = annotations.map((a) => a.text);
  if (texts.some((a) => a.includes("Composable"))) return "composable";
  if (texts.some((a) => a.includes("Provides") || a.includes("Binds"))) return "di_provider";
  return "function";
}

function classifyTags(
  node: Parser.SyntaxNode,
  annotations: Parser.SyntaxNode[],
  text: string,
): string[] {
  const tags: string[] = [];
  const annotTexts = annotations.map((a) => a.text.toLowerCase());

  if (annotTexts.some((a) => a.includes("hiltviewmodel") || a.includes("inject"))) tags.push("hilt");
  if (annotTexts.some((a) => a.includes("composable"))) tags.push("compose");
  if (text.includes("StateFlow") || text.includes("LiveData")) tags.push("state");
  if (text.includes("suspend ")) tags.push("coroutine");
  if (text.includes("Room") || annotTexts.some((a) => a.includes("dao") || a.includes("entity"))) tags.push("room");
  if (annotTexts.some((a) => a.includes("test") || a.includes("before") || a.includes("after"))) tags.push("test");

  return tags;
}

function classifyFunctionTags(annotations: Parser.SyntaxNode[]): string[] {
  const tags: string[] = [];
  const texts = annotations.map((a) => a.text.toLowerCase());
  if (texts.some((a) => a.includes("composable"))) tags.push("compose");
  if (texts.some((a) => a.includes("provides") || a.includes("binds"))) tags.push("hilt", "di");
  if (texts.some((a) => a.includes("test"))) tags.push("test");
  return tags;
}

function extractClassSignature(node: Parser.SyntaxNode, lines: string[]): string {
  // Get the line(s) up to the opening brace
  const startLine = node.startPosition.row;
  for (let i = startLine; i <= Math.min(startLine + 5, lines.length - 1); i++) {
    if (lines[i].includes("{")) {
      return lines
        .slice(startLine, i + 1)
        .join("\n")
        .replace(/\{[\s\S]*$/, "{")
        .trim();
    }
  }
  return lines[startLine]?.trim() ?? "";
}

function extractFunctionSignature(node: Parser.SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  for (let i = startLine; i <= Math.min(startLine + 3, lines.length - 1); i++) {
    const line = lines[i];
    if (line.includes("{") || line.includes("=")) {
      return lines
        .slice(startLine, i + 1)
        .join("\n")
        .replace(/[{=][\s\S]*$/, "")
        .trim();
    }
  }
  return lines[startLine]?.trim() ?? "";
}

function extractUses(text: string, imports: string[]): string[] {
  const uses: string[] = [];
  for (const imp of imports) {
    const parts = imp.split(".");
    const shortName = parts[parts.length - 1];
    if (shortName && text.includes(shortName)) {
      uses.push(imp);
    }
  }
  return uses;
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

