import { basename } from "node:path";
import type { Chunk, ChunkKind, ChunkerPlugin } from "./types.js";
import { hashContent, chunkId } from "./utils.js";

export const xmlAndroidChunker: ChunkerPlugin = {
  id: "xml-android",

  supports(filePath: string, language: string): boolean {
    return language === "xml";
  },

  chunk(filePath: string, content: string): Chunk[] {
    const fileName = basename(filePath).toLowerCase();

    if (fileName === "androidmanifest.xml") {
      return chunkManifest(filePath, content);
    }

    if (filePath.includes("/navigation/") || filePath.includes("/nav/")) {
      return chunkNavigation(filePath, content);
    }

    if (filePath.includes("/layout/")) {
      return chunkLayout(filePath, content);
    }

    if (filePath.includes("/values/")) {
      return chunkValues(filePath, content);
    }

    // Generic XML: one chunk per file
    return [makeFileChunk(filePath, content, "layout")];
  },
};

function chunkManifest(filePath: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const componentPatterns = [
    { regex: /<activity[\s\S]*?(?:\/>|<\/activity>)/g, kind: "manifest_component" as ChunkKind },
    { regex: /<service[\s\S]*?(?:\/>|<\/service>)/g, kind: "manifest_component" as ChunkKind },
    { regex: /<receiver[\s\S]*?(?:\/>|<\/receiver>)/g, kind: "manifest_component" as ChunkKind },
    { regex: /<provider[\s\S]*?(?:\/>|<\/provider>)/g, kind: "manifest_component" as ChunkKind },
  ];

  for (const { regex, kind } of componentPatterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const text = match[0];
      const startOffset = match.index;
      const startLine = content.slice(0, startOffset).split("\n").length;
      const endLine = startLine + text.split("\n").length - 1;
      const name = extractXmlAttribute(text, "android:name") ?? `component@${startLine}`;

      const contentHash = hashContent(text);
      const id = chunkId(filePath, startLine, endLine, contentHash);

      chunks.push({
        id,
        path: filePath,
        language: "xml",
        kind,
        symbolName: name.split(".").pop() ?? name,
        symbolFqname: name,
        startLine,
        endLine,
        textRaw: text,
        textSketch: text, // XML is usually compact enough
        tags: ["manifest"],
        annotations: [],
        defines: [name],
        uses: [],
        contentHash,
      });
    }
  }

  // If no components found, return whole file
  if (chunks.length === 0) {
    return [makeFileChunk(filePath, content, "manifest_component")];
  }

  return chunks;
}

function chunkNavigation(filePath: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const destRegex = /<(?:fragment|composable|dialog)[\s\S]*?(?:\/>|<\/(?:fragment|composable|dialog)>)/g;

  let match: RegExpExecArray | null;
  while ((match = destRegex.exec(content)) !== null) {
    const text = match[0];
    const startOffset = match.index;
    const startLine = content.slice(0, startOffset).split("\n").length;
    const endLine = startLine + text.split("\n").length - 1;
    const name = extractXmlAttribute(text, "android:id")
      ?? extractXmlAttribute(text, "android:name")
      ?? `dest@${startLine}`;

    const contentHash = hashContent(text);
    const id = chunkId(filePath, startLine, endLine, contentHash);

    chunks.push({
      id,
      path: filePath,
      language: "xml",
      kind: "nav_destination",
      symbolName: name.replace("@+id/", "").replace("@id/", ""),
      startLine,
      endLine,
      textRaw: text,
      textSketch: text,
      tags: ["navigation"],
      annotations: [],
      defines: [name],
      uses: extractNavActions(text),
      contentHash,
    });
  }

  if (chunks.length === 0) {
    return [makeFileChunk(filePath, content, "nav_destination")];
  }

  return chunks;
}

function chunkLayout(filePath: string, content: string): Chunk[] {
  // Layouts: one chunk per file with sketch showing root view and main IDs
  const rootMatch = content.match(/<(\w+(?:\.\w+)*)/);
  const rootView = rootMatch ? rootMatch[1] : "View";

  const ids: string[] = [];
  const idRegex = /android:id="@\+id\/(\w+)"/g;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(content)) !== null) {
    ids.push(idMatch[1]);
  }

  const sketch = `Root: ${rootView}\nIDs: ${ids.join(", ") || "(none)"}`;

  const lines = content.split("\n");
  const contentHash = hashContent(content);
  const id = chunkId(filePath, 1, lines.length, contentHash);

  return [{
    id,
    path: filePath,
    language: "xml",
    kind: "layout",
    symbolName: basename(filePath).replace(".xml", ""),
    startLine: 1,
    endLine: lines.length,
    textRaw: content,
    textSketch: sketch,
    tags: ["layout"],
    annotations: [],
    defines: ids.map((i) => `@+id/${i}`),
    uses: [],
    contentHash,
  }];
}

function chunkValues(filePath: string, content: string): Chunk[] {
  return [makeFileChunk(filePath, content, "values")];
}

function makeFileChunk(filePath: string, content: string, kind: ChunkKind): Chunk {
  const lines = content.split("\n");
  const contentHash = hashContent(content);
  const id = chunkId(filePath, 1, lines.length, contentHash);

  return {
    id,
    path: filePath,
    language: "xml",
    kind,
    symbolName: basename(filePath).replace(".xml", ""),
    startLine: 1,
    endLine: lines.length,
    textRaw: content,
    textSketch: content.length > 800 ? content.slice(0, 800) + "\n..." : content,
    tags: [],
    annotations: [],
    defines: [],
    uses: [],
    contentHash,
  };
}

function extractXmlAttribute(text: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = text.match(regex);
  return match ? match[1] : null;
}

function extractNavActions(text: string): string[] {
  const actions: string[] = [];
  const actionRegex = /app:destination="@id\/(\w+)"/g;
  let match: RegExpExecArray | null;
  while ((match = actionRegex.exec(text)) !== null) {
    actions.push(match[1]);
  }
  return actions;
}

