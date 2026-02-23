/**
 * Approximate token counting using a simple heuristic.
 * ~4 characters per token for English text / code is a reasonable estimate.
 * This avoids depending on tiktoken which has native bindings.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(text: string, budget: number): string {
  const maxChars = budget * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... (truncated)";
}
