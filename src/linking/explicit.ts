import type { Issue, Link, PullRequest } from "../connectors/types.js";
import { extractIssueKeys } from "./keys.js";

const CLOSING_KEYWORD_RE = /\b(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s*:?\s*([A-Za-z][A-Za-z0-9]+-\d+)\b/gi;

/**
 * Explicit links: a PR title/body using a GitHub-style closing keyword ("Closes NOVA-142",
 * "Fixes NOVA-142") — the strongest, most intentional developer signal. Confidence 1.0.
 * A bare key mention with no closing keyword is NOT explicit (too ambiguous to trust at
 * High severity); see linking/fuzzy.ts.
 */
export function extractExplicitLinks(pullRequests: PullRequest[], issues: Issue[], projectKeys: string[]): Link[] {
  const issueIdByKey = new Map(issues.map((i) => [i.key.toUpperCase(), i.id]));
  const links: Link[] = [];

  for (const pr of pullRequests) {
    const text = `${pr.title}\n${pr.body ?? ""}`;
    for (const match of text.matchAll(CLOSING_KEYWORD_RE)) {
      const keys = extractIssueKeys(match[2]!, projectKeys);
      for (const key of keys) {
        const issueId = issueIdByKey.get(key);
        if (!issueId) continue;
        links.push({ issueId, prId: pr.id, linkSource: "explicit", confidence: 1.0 });
      }
    }
  }

  return links;
}
