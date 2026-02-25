/**
 * Information Retrieval metrics for evaluating search quality.
 * All functions are pure — no side effects or I/O.
 */

/**
 * Mean Reciprocal Rank — how high is the first relevant result?
 * Returns 1/rank of the first relevant result, or 0 if none found.
 */
export function mrr(rankedResults: string[], relevant: Set<string>): number {
  for (let i = 0; i < rankedResults.length; i++) {
    if (relevant.has(rankedResults[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Discounted Cumulative Gain at K.
 * Uses binary relevance: 1 if in the ordered relevant list, 0 otherwise.
 * Relevance is graded by position in the expected list (first = highest).
 */
function dcgAtK(rankedResults: string[], relevanceMap: Map<string, number>, k: number): number {
  let dcg = 0;
  const n = Math.min(rankedResults.length, k);
  for (let i = 0; i < n; i++) {
    const rel = relevanceMap.get(rankedResults[i]) ?? 0;
    dcg += rel / Math.log2(i + 2); // +2 because log2(1)=0
  }
  return dcg;
}

/**
 * NDCG@K — Normalized Discounted Cumulative Gain.
 * Measures whether the ranking order is optimal.
 * `relevant` is an ordered array where position implies graded relevance
 * (first element = most relevant).
 */
export function ndcgAtK(rankedResults: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 0;

  // Build graded relevance: first expected item gets highest score
  const relevanceMap = new Map<string, number>();
  for (let i = 0; i < relevant.length; i++) {
    relevanceMap.set(relevant[i], relevant.length - i);
  }

  const dcg = dcgAtK(rankedResults, relevanceMap, k);

  // Ideal DCG: relevant items in perfect order
  const idealRanking = [...relevant];
  const idcg = dcgAtK(idealRanking, relevanceMap, k);

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Precision@K — what fraction of the top-K results are relevant?
 */
export function precisionAtK(rankedResults: string[], relevant: Set<string>, k: number): number {
  const n = Math.min(rankedResults.length, k);
  if (n === 0) return 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (relevant.has(rankedResults[i])) hits++;
  }
  return hits / k;
}

/**
 * Recall@K — what fraction of relevant docs appear in the top-K?
 */
export function recallAtK(rankedResults: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const n = Math.min(rankedResults.length, k);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (relevant.has(rankedResults[i])) hits++;
  }
  return hits / relevant.size;
}
