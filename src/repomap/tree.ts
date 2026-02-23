import type Database from "better-sqlite3";
import { shouldIgnore } from "../utils/ignore.js";

export interface TreeNode {
  name: string;
  type: "dir" | "file";
  children?: TreeNode[];
  chunkCount?: number;
}

export interface RenderOptions {
  maxDepth?: number; // Collapse directories deeper than this into "(X files)" summaries
}

/**
 * Generate a pruned directory tree from indexed files.
 */
export function generateTree(
  db: Database.Database,
  repoPath: string,
  module?: string,
): TreeNode {
  let sql = "SELECT DISTINCT path FROM chunks WHERE repo_path = ?";
  const params: unknown[] = [repoPath];

  if (module) {
    sql += " AND module = ?";
    params.push(module);
  }

  const rows = db.prepare(sql).all(...params) as Array<{ path: string }>;
  const paths = rows.map((r) => r.path).filter((p) => !shouldIgnore(p));

  // Build tree structure
  const root: TreeNode = { name: ".", type: "dir", children: [] };

  for (const filePath of paths) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!current.children) current.children = [];

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, type: isFile ? "file" : "dir" };
        if (!isFile) child.children = [];
        current.children.push(child);
      }

      if (!isFile) {
        current = child;
      } else {
        // Attach chunk count for files
        const count = db
          .prepare("SELECT COUNT(*) as cnt FROM chunks WHERE repo_path = ? AND path = ?")
          .get(repoPath, filePath) as { cnt: number };
        child.chunkCount = count.cnt;
      }
    }
  }

  // Sort children: dirs first, then files, alphabetical
  sortTree(root);

  return root;
}

function sortTree(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    sortTree(child);
  }
}

function countDescendantFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, child) => sum + countDescendantFiles(child), 0);
}

/**
 * Render tree as a text string for display.
 * When maxDepth is set, directories deeper than that level are collapsed
 * into a single line showing the total file count underneath.
 */
export function renderTree(node: TreeNode, options?: RenderOptions): string {
  const maxDepth = options?.maxDepth ?? Infinity;
  return renderNode(node, "", true, 0, maxDepth);
}

function renderNode(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
  depth: number,
  maxDepth: number,
): string {
  const lines: string[] = [];
  const connector = isLast ? "└── " : "├── ";
  const childPrefix = isLast ? "    " : "│   ";

  if (node.name !== ".") {
    // Collapse deep directories into a summary line
    if (node.type === "dir" && depth > maxDepth && node.children && node.children.length > 0) {
      const fileCount = countDescendantFiles(node);
      lines.push(prefix + connector + node.name + `/ (${fileCount} files)`);
      return lines.join("\n");
    }

    const suffix = node.chunkCount ? ` (${node.chunkCount} chunks)` : "";
    lines.push(prefix + connector + node.name + suffix);
  }

  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const last = i === node.children.length - 1;
      const newPrefix = node.name === "." ? "" : prefix + childPrefix;
      lines.push(renderNode(child, newPrefix, last, depth + 1, maxDepth));
    }
  }

  return lines.join("\n");
}
