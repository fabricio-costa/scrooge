export type QueryVariantName = "exact" | "strict" | "broad" | "expanded";

export interface SearchQueryVariant {
  name: QueryVariantName;
  query: string;
  weight: number;
}

export interface SearchQueryPlan {
  original: string;
  identifierLike: boolean;
  terms: string[];
  exactTerms: string[];
  expansionTerms: string[];
  allTerms: string[];
  likeTerms: string[];
  aliasesUsed: string[];
  languageHints: string[];
  kindHints: string[];
  variants: SearchQueryVariant[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "does",
  "for",
  "from",
  "get",
  "give",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "of",
  "on",
  "or",
  "please",
  "show",
  "that",
  "the",
  "this",
  "to",
  "using",
  "what",
  "where",
  "which",
  "with",
]);

const TERM_ALIASES: Record<string, readonly string[]> = {
  api: ["service", "client", "endpoint"],
  auth: ["authentication", "authorization"],
  cfg: ["config", "configuration", "settings"],
  config: ["cfg", "configuration", "settings"],
  configuration: ["config", "cfg", "settings"],
  db: ["database", "sql", "sqlite"],
  database: ["db", "sql", "sqlite"],
  impl: ["implementation"],
  kt: ["kotlin"],
  py: ["python"],
  repo: ["repository"],
  repository: ["repo"],
  service: ["api", "client"],
  svc: ["service"],
  ts: ["typescript"],
  tsx: ["typescript", "react"],
  ui: ["screen", "view"],
  util: ["utility", "utils"],
  utility: ["util", "utils"],
  utils: ["util", "utility"],
  vm: ["viewmodel", "view", "model"],
  viewmodel: ["vm", "view", "model"],
};

const LANGUAGE_HINTS: Record<string, string> = {
  dart: "dart",
  gradle: "gradle",
  kt: "kotlin",
  kotlin: "kotlin",
  py: "python",
  python: "python",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  xml: "xml",
};

const KIND_HINTS: Record<string, string> = {
  api: "api_interface",
  composable: "composable",
  dao: "dao",
  function: "function",
  gradle: "build_config",
  hook: "hook",
  interface: "api_interface",
  layout: "layout",
  manifest: "manifest",
  method: "function",
  module: "hilt_module",
  repo: "class",
  repository: "class",
  screen: "screen",
  service: "api_interface",
  viewmodel: "viewmodel",
  vm: "viewmodel",
  xml: "layout",
};

export function extractSearchTerms(query: string): string[] {
  return buildSearchQueryPlan(query).terms;
}

export function buildSearchQueryPlan(query: string): SearchQueryPlan {
  const rawTerms = tokenizeTerms(query);
  const filteredTerms = rawTerms.filter((term) => !STOP_WORDS.has(term));
  const terms = unique(filteredTerms.length > 0 ? filteredTerms : rawTerms);
  const identifierLike = isIdentifierLikeQuery(query);
  const exactTerms = identifierLike ? extractExactTerms(query) : [];

  const expansions = new Set<string>();
  const aliasesUsed = new Set<string>();
  for (const term of [...terms, ...exactTerms]) {
    const singular = singularize(term);
    if (singular && !terms.includes(singular) && !exactTerms.includes(singular)) {
      expansions.add(singular);
      aliasesUsed.add(`${term}->${singular}`);
    }

    const aliases = TERM_ALIASES[term] ?? [];
    for (const alias of aliases) {
      if (!terms.includes(alias) && !exactTerms.includes(alias)) {
        expansions.add(alias);
      }
      aliasesUsed.add(`${term}->${alias}`);
    }
  }

  const expansionTerms = [...expansions]
    .filter((term) => term.length >= 2)
    .slice(0, 10);
  const allTerms = unique([...exactTerms, ...terms, ...expansionTerms]);
  const likeTerms = allTerms.slice(0, 8);

  const hintTerms = unique([...terms, ...expansionTerms]);
  const languageHints = unique(hintTerms.map((term) => LANGUAGE_HINTS[term]).filter(Boolean));
  const kindHints = unique(hintTerms.map((term) => KIND_HINTS[term]).filter(Boolean));

  const broadTerms = unique([...exactTerms, ...terms]).slice(0, 10);
  const strictTerms = pickCoreTerms(terms).slice(0, 4);
  const variants: SearchQueryVariant[] = [];

  const exactQuery = buildOrFtsQuery(exactTerms);
  if (exactQuery) {
    variants.push({ name: "exact", query: exactQuery, weight: 1.45 });
  }

  const strictQuery = strictTerms.length > 1 ? buildAndFtsQuery(strictTerms) : "";
  if (strictQuery) {
    variants.push({ name: "strict", query: strictQuery, weight: 1.2 });
  }

  const broadQuery = buildOrFtsQuery(broadTerms);
  if (broadQuery) {
    variants.push({ name: "broad", query: broadQuery, weight: 1.0 });
  }

  const expandedQuery = buildOrFtsQuery(expansionTerms);
  if (expandedQuery) {
    variants.push({ name: "expanded", query: expandedQuery, weight: 0.7 });
  }

  return {
    original: query,
    identifierLike,
    terms,
    exactTerms,
    expansionTerms,
    allTerms,
    likeTerms,
    aliasesUsed: [...aliasesUsed],
    languageHints,
    kindHints,
    variants,
  };
}

function tokenizeTerms(query: string): string[] {
  const normalized = query
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase();

  return unique(
    normalized
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  );
}

function extractExactTerms(query: string): string[] {
  const tokens = query.split(/\s+/).filter(Boolean);
  const exact = new Set<string>();

  for (const token of tokens) {
    const trimmed = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    if (!trimmed) continue;

    const compact = trimmed.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (compact.length < 3) continue;

    const isPlainToken = /^[a-z0-9]+$/i.test(trimmed);
    const isCamelOrPascal = /[a-z][A-Z]|[A-Z][a-z]/.test(trimmed);
    if (isPlainToken || isCamelOrPascal) {
      exact.add(compact);
    }
  }

  return [...exact];
}

function isIdentifierLikeQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  return trimmed.split(/\s+/).length === 1 || /[a-z][A-Z]|[A-Z][a-z]|[./_-]/.test(trimmed);
}

function singularize(term: string): string | null {
  if (term.length <= 3) return null;
  if (term.endsWith("ies") && term.length > 4) {
    return term.slice(0, -3) + "y";
  }
  if (term.endsWith("sses") && term.length > 5) {
    return term.slice(0, -2);
  }
  if (term.endsWith("s") && !term.endsWith("ss")) {
    return term.slice(0, -1);
  }
  return null;
}

function pickCoreTerms(terms: string[]): string[] {
  return [...terms]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 4);
}

function buildOrFtsQuery(terms: string[]): string {
  const sanitized = terms.map(sanitizeFtsTerm).filter(Boolean);
  if (sanitized.length === 0) return "";
  return sanitized.map((term) => `"${term}"`).join(" OR ");
}

function buildAndFtsQuery(terms: string[]): string {
  const sanitized = terms.map(sanitizeFtsTerm).filter(Boolean);
  if (sanitized.length === 0) return "";
  return sanitized.map((term) => `"${term}"`).join(" AND ");
}

function sanitizeFtsTerm(term: string): string {
  return term.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
