export type ChunkKind =
  | "class"
  | "object"
  | "function"
  | "method"
  | "composable"
  | "viewmodel"
  | "di_provider"
  | "api_interface"
  | "dao"
  | "entity"
  | "interface"
  | "type_alias"
  | "enum"
  | "manifest_component"
  | "nav_destination"
  | "layout"
  | "values"
  | "gradle_plugins"
  | "gradle_android"
  | "gradle_dependencies"
  | "gradle_signing"
  | "gradle_settings"
  | "dataclass"
  | "mixin"
  | "extension"
  | "generic_block"
  | "generic_file";

export interface Chunk {
  id: string;
  path: string;
  module?: string;
  sourceSet?: string;
  language: string;
  kind: ChunkKind;
  symbolName?: string;
  symbolFqname?: string;
  signature?: string;
  startLine: number;
  endLine: number;
  textRaw: string;
  textSketch: string;
  tags: string[];
  annotations: string[];
  defines: string[];
  uses: string[];
  contentHash: string;
}

export interface ChunkerPlugin {
  id: string;
  supports(filePath: string, language: string): boolean;
  chunk(filePath: string, content: string): Chunk[];
}
