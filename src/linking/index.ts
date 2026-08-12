import type { Commit, Issue, Link, PullRequest } from "../connectors/types.js";
import { extractExplicitLinks } from "./explicit.js";
import { extractBranchNameLinks, extractCommitRefLinks } from "./implicit.js";
import { extractFuzzyLinks, type FuzzyLinkerClient } from "./fuzzy.js";

export { extractExplicitLinks } from "./explicit.js";
export { extractBranchNameLinks, extractCommitRefLinks } from "./implicit.js";
export { createHaikuLinker, extractFuzzyLinks, type FuzzyLinkerClient } from "./fuzzy.js";

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

/**
 * resolveLinks() plus the fuzzy (B19) pass on top, when a linker is supplied. Kept as a separate
 * async function rather than changing resolveLinks() itself — fuzzy matching needs an Anthropic
 * key and makes real LLM calls, so callers without one (or that don't want the cost/latency) keep
 * using the synchronous rule-based-only path unchanged.
 */
export async function resolveLinksWithFuzzy(
  pullRequests: PullRequest[],
  commits: Commit[],
  issues: Issue[],
  projectKeys: string[],
  linker?: FuzzyLinkerClient,
): Promise<Link[]> {
  const ruleBasedLinks = resolveLinks(pullRequests, commits, issues, projectKeys);
  if (!linker) return ruleBasedLinks;

  const fuzzyLinks = await extractFuzzyLinks(pullRequests, issues, ruleBasedLinks, linker);
  return mergeLinks([...ruleBasedLinks, ...fuzzyLinks]);
}
