# Scrooge Eval

Ground-truth evaluation suite for measuring search quality.

## Quick Start

```bash
npm run eval
```

## Query Format

Each line in `queries.jsonl` is a test case:

```json
{
  "query": "hybrid search RRF fusion",
  "repo": ".",
  "expected": ["src/retrieval/hybrid.ts"],
  "expected_symbols": ["hybridSearch"],
  "tags": ["retrieval"]
}
```

| Field              | Required | Description                                           |
|--------------------|----------|-------------------------------------------------------|
| `query`            | yes      | Search query text                                     |
| `repo`             | yes      | Repository path (`.` = current repo)                  |
| `expected`         | yes      | File paths that should appear (order = relevance)     |
| `expected_symbols` | no       | Symbol names that should appear                       |
| `tags`             | no       | Categories for per-tag breakdowns                     |

## Metrics

| Metric        | What it measures                                  |
|---------------|---------------------------------------------------|
| **MRR**       | How high is the first relevant result? (1 = top)  |
| **NDCG@5**    | Is the ranking order optimal?                     |
| **Precision@5** | What fraction of top-5 are relevant?           |
| **Recall@5**  | What fraction of relevant docs appear in top-5?   |

## Comparing Configs

```bash
npm run eval -- --compare '{"rrfK":60}' '{"rrfK":100}'
```

## Adding Queries

1. Run a search that returns poor results
2. Add a line to `queries.jsonl` with the query and expected files
3. Run `npm run eval` to get baseline metrics
4. Tune parameters and re-run to verify improvement
