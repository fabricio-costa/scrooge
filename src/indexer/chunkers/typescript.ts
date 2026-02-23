import Parser from "tree-sitter";
import TypeScriptLanguage from "tree-sitter-typescript";
import type { Chunk, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";
import { generateSketch } from "../sketcher.js";

const tsParser = new Parser();
tsParser.setLanguage(TypeScriptLanguage.typescript);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScriptLanguage.tsx);

const MAX_CLASS_LINES = 400;

export const typescriptChunker: ChunkerPlugin = {
  id: "typescript",

  supports(_filePath: string, language: string): boolean {
    return language === "typescript";
  },

  chunk(filePath: string, content: string): Chunk[] {
    const parser = filePath.endsWith(".tsx") ? tsxParser : tsParser;
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
    // Look for preceding doc comment (/** ... */)
    const commentStartLine = getPrecedingCommentStart(node, i);

    switch (child.type) {
      case "export_statement": {
        // Unwrap: find the declaration child and process it
        const decl = findDeclarationChild(child);
        if (decl) {
          processNode(decl, filePath, lines, imports, chunks, true, commentStartLine);
        } else {
          // export default or re-export — check for default function/class
          for (const sub of child.children) {
            if (isProcessableNode(sub)) {
              processNode(sub, filePath, lines, imports, chunks, true, commentStartLine);
            }
          }
        }
        break;
      }
      default:
        if (isProcessableNode(child)) {
          processNode(child, filePath, lines, imports, chunks, false, commentStartLine);
        }
        break;
    }
  }
}

function getPrecedingCommentStart(parent: Parser.SyntaxNode, index: number): number | undefined {
  if (index <= 0) return undefined;
  const prev = parent.children[index - 1];
  if (prev.type === "comment" && prev.text.startsWith("/**")) {
    return prev.startPosition.row;
  }
  return undefined;
}

function isProcessableNode(node: Parser.SyntaxNode): boolean {
  return [
    "class_declaration",
    "abstract_class_declaration",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "function_declaration",
    "lexical_declaration",
  ].includes(node.type);
}

function findDeclarationChild(exportNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
  for (const child of exportNode.children) {
    if (isProcessableNode(child)) return child;
  }
  return null;
}

function processNode(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  chunks: Chunk[],
  isExported: boolean,
  commentStartLine?: number,
): void {
  switch (node.type) {
    case "class_declaration":
    case "abstract_class_declaration": {
      const result = processClass(node, filePath, lines, imports, isExported, commentStartLine);
      if (result) chunks.push(...result);
      break;
    }
    case "interface_declaration": {
      const chunk = processInterface(node, filePath, lines, imports, isExported, commentStartLine);
      if (chunk) chunks.push(chunk);
      break;
    }
    case "type_alias_declaration": {
      const chunk = processTypeAlias(node, filePath, lines, imports, isExported, commentStartLine);
      if (chunk) chunks.push(chunk);
      break;
    }
    case "enum_declaration": {
      const chunk = processEnum(node, filePath, lines, imports, isExported, commentStartLine);
      if (chunk) chunks.push(chunk);
      break;
    }
    case "function_declaration": {
      const chunk = processFunction(node, filePath, lines, imports, isExported, commentStartLine);
      if (chunk) chunks.push(chunk);
      break;
    }
    case "lexical_declaration": {
      const chunk = processVariableDeclaration(node, filePath, lines, imports, isExported, commentStartLine);
      if (chunk) chunks.push(chunk);
      break;
    }
  }
}

function processClass(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  isExported: boolean,
  commentStartLine?: number,
): Chunk[] | null {
  const name = findChildByType(node, "type_identifier")?.text;
  if (!name) return null;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const lineCount = endLine - startLine + 1;
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, isExported);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const baseChunk: Chunk = {
    id,
    path: filePath,
    language: "typescript",
    kind: "class",
    symbolName: name,
    symbolFqname: fqname,
    signature,
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

  baseChunk.textSketch = generateSketch(baseChunk);

  if (lineCount > MAX_CLASS_LINES) {
    const methodChunks = extractMethodChunks(node, filePath, lines, fqname, imports, isExported);
    return [baseChunk, ...methodChunks];
  }

  return [baseChunk];
}

function processInterface(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  isExported: boolean,
  commentStartLine?: number,
): Chunk | null {
  const name = findChildByType(node, "type_identifier")?.text;
  if (!name) return null;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, isExported);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "typescript",
    kind: "interface",
    symbolName: name,
    symbolFqname: fqname,
    signature,
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
  return chunk;
}

function processTypeAlias(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  isExported: boolean,
  commentStartLine?: number,
): Chunk | null {
  const name = findChildByType(node, "type_identifier")?.text;
  if (!name) return null;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const tags = classifyTags(textRaw, isExported);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "typescript",
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
  return chunk;
}

function processEnum(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  isExported: boolean,
  commentStartLine?: number,
): Chunk | null {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return null;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, isExported);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "typescript",
    kind: "enum",
    symbolName: name,
    symbolFqname: fqname,
    signature,
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
  return chunk;
}

function processFunction(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  isExported: boolean,
  commentStartLine?: number,
): Chunk | null {
  const name = findChildByType(node, "identifier")?.text;
  if (!name) return null;

  const fqname = `${filePath}.${name}`;
  const startLine = commentStartLine != null ? commentStartLine + 1 : node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const textRaw = commentStartLine != null
    ? lines.slice(commentStartLine, node.endPosition.row + 1).join("\n")
    : getNodeText(node, lines);
  const signature = extractSignature(node, lines);
  const tags = classifyTags(textRaw, isExported);

  const contentHash_ = hashContent(textRaw);
  const id = chunkId(filePath, startLine, endLine, contentHash_);

  const chunk: Chunk = {
    id,
    path: filePath,
    language: "typescript",
    kind: "function",
    symbolName: name,
    symbolFqname: fqname,
    signature,
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
  return chunk;
}

function processVariableDeclaration(
  node: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  imports: string[],
  isExported: boolean,
  _commentStartLine?: number,
): Chunk | null {
  // Look for const/let declarations that have arrow functions or significant values
  for (const child of node.children) {
    if (child.type === "variable_declarator") {
      const nameNode = findChildByType(child, "identifier");
      if (!nameNode) continue;

      const name = nameNode.text;
      const value = findChildByType(child, "arrow_function")
        ?? findChildByType(child, "function");

      // Only chunk arrow functions / function expressions, or top-level const exports
      if (!value && !isExported) continue;

      const fqname = `${filePath}.${name}`;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const textRaw = getNodeText(node, lines);
      const tags = classifyTags(textRaw, isExported);

      const contentHash_ = hashContent(textRaw);
      const id = chunkId(filePath, startLine, endLine, contentHash_);

      const chunk: Chunk = {
        id,
        path: filePath,
        language: "typescript",
        kind: "function",
        symbolName: name,
        symbolFqname: fqname,
        signature: extractSignature(node, lines),
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
      return chunk;
    }
  }

  return null;
}

function extractMethodChunks(
  classNode: Parser.SyntaxNode,
  filePath: string,
  lines: string[],
  classFqname: string,
  imports: string[],
  isExported: boolean,
): Chunk[] {
  const body = findChildByType(classNode, "class_body");
  if (!body) return [];

  const chunks: Chunk[] = [];
  for (const child of body.children) {
    if (child.type === "method_definition" || child.type === "public_field_definition") {
      const name = findChildByType(child, "property_identifier")?.text;
      if (!name) continue;

      const fqname = `${classFqname}.${name}`;
      const startLine = child.startPosition.row + 1;
      const endLine = child.endPosition.row + 1;
      const textRaw = getNodeText(child, lines);
      const signature = extractSignature(child, lines);
      const tags = classifyTags(textRaw, isExported);

      const contentHash_ = hashContent(textRaw);
      const id = chunkId(filePath, startLine, endLine, contentHash_);

      const chunk: Chunk = {
        id,
        path: filePath,
        language: "typescript",
        kind: "method",
        symbolName: name,
        symbolFqname: fqname,
        signature,
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
  }

  return chunks;
}

// --- Helpers ---

function extractImports(root: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  for (const child of root.children) {
    if (child.type === "import_statement") {
      // Extract imported names from import clauses
      const clause = findChildByType(child, "import_clause");
      if (clause) {
        // Named imports: import { Foo, Bar } from "..."
        const named = findChildByType(clause, "named_imports");
        if (named) {
          for (const spec of named.children) {
            if (spec.type === "import_specifier") {
              const name = findChildByType(spec, "identifier");
              if (name) imports.push(name.text);
            }
          }
        }
        // Default import: import Foo from "..."
        const defaultImport = findChildByType(clause, "identifier");
        if (defaultImport) imports.push(defaultImport.text);
        // Namespace import: import * as Foo from "..."
        const nsImport = findChildByType(clause, "namespace_import");
        if (nsImport) {
          const nsName = findChildByType(nsImport, "identifier");
          if (nsName) imports.push(nsName.text);
        }
      }

      // Extract module path for uses tracking
      const source = findChildByType(child, "string")?.text?.replace(/['"]/g, "");
      if (source) imports.push(source);
    }
  }
  return imports;
}

function extractSignature(node: Parser.SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  for (let i = startLine; i <= Math.min(startLine + 5, lines.length - 1); i++) {
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
    // Skip module paths that start with . or contain /
    if (imp.startsWith(".") || imp.includes("/")) {
      if (text.includes(imp)) uses.push(imp);
      continue;
    }
    // For named imports, check if they appear in the text
    if (text.includes(imp)) {
      uses.push(imp);
    }
  }
  return [...new Set(uses)];
}

function classifyTags(text: string, isExported: boolean): string[] {
  const tags: string[] = [];
  if (isExported || text.includes("export ")) tags.push("export");
  if (text.includes("async ") || text.includes("Promise<") || text.includes("await ")) tags.push("async");
  if (/\b(describe|it|test|expect)\b/.test(text)) tags.push("test");
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
