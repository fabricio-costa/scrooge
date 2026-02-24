/**
 * Escape LIKE metacharacters to prevent wildcard injection.
 * Use with `ESCAPE '\'` in the SQL query.
 */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}
