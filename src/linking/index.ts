import type { Commit, Issue, Link, PullRequest } from "../connectors/types.js";
import { extractExplicitLinks } from "./explicit.js";
import { extractBranchNameLinks, extractCommitRefLinks } from "./implicit.js";

export { extractExplicitLinks } from "./explicit.js";
export { extractBranchNameLinks, extractCommitRefLinks } from "./implicit.js";

/** One link per (issue, PR) pair — when multiple sources agree, keep the highest-confidence one. */
export function mergeLinks(links: Link[]): Link[] {
  const best = new Map<string, Link>();
  for (const link of links) {
    const key = `${link.issueId}:${link.prId}`;
    const existing = best.get(key);
    if (!existing || link.confidence > existing.confidence) {
      best.set(key, link);
    }
  }
  return [...best.values()];
}

/** Runs all rule-based linking sources (B7 explicit, B8 branch/commit) and merges the result. */
export function resolveLinks(pullRequests: PullRequest[], commits: Commit[], issues: Issue[], projectKeys: string[]): Link[] {
  return mergeLinks([
    ...extractExplicitLinks(pullRequests, issues, projectKeys),
    ...extractBranchNameLinks(pullRequests, issues, projectKeys),
    ...extractCommitRefLinks(pullRequests, commits, issues, projectKeys),
  ]);
}
