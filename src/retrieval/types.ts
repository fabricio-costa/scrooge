import type { ChunkRow } from "../storage/db.js";

export interface SearchFilter {
  module?: string;
  language?: string;
  kind?: string;
  tags?: string[];
}

export interface SearchResult {
  chunk: ChunkRow;
  score: number;
  source: "lexical" | "vector" | "both";
  rank: number;
}
