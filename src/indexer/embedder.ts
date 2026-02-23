import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { getConfig } from "../utils/config.js";

let _embedder: FeatureExtractionPipeline | null = null;

/**
 * Initialize the embedding model. Call once at server startup.
 * Uses all-MiniLM-L6-v2 which outputs 384-dimensional embeddings.
 */
export async function initEmbedder(): Promise<void> {
  if (_embedder) return;
  const config = getConfig();
  _embedder = await pipeline("feature-extraction", config.embeddingModel, {
    quantized: true,
  });
}

/**
 * Generate embedding for a single text input.
 * Returns a Float32Array of 384 dimensions.
 */
export async function embed(text: string): Promise<Float32Array> {
  if (!_embedder) {
    await initEmbedder();
  }

  const result = await _embedder!(text, {
    pooling: "mean",
    normalize: true,
  });

  return new Float32Array(result.data as ArrayLike<number>);
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}
