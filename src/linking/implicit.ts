import type { Commit, Issue, Link, PullRequest } from "../connectors/types.js";
import { extractIssueKeys } from "./keys.js";

/**
 * Branch-name links: the PR's branch encodes an issue key (e.g. "priya/nova-142-rate-limit").
 * Strong convention signal, but not an explicit developer statement — confidence 0.9.
 */
export function extractBranchNameLinks(pullRequests: PullRequest[], issues: Issue[], projectKeys: string[]): Link[] {
  const issueIdByKey = new Map(issues.map((i) => [i.key.toUpperCase(), i.id]));
  const links: Link[] = [];

  for (const pr of pullRequests) {
    if (!pr.branch) continue;
    for (const key of extractIssueKeys(pr.branch, projectKeys)) {
      const issueId = issueIdByKey.get(key);
      if (!issueId) continue;
      links.push({ issueId, prId: pr.id, linkSource: "branch_name", confidence: 0.9 });
    }
  }

  return links;
}

/**
 * Commit-ref links: a commit on the PR's branch mentions an issue key in its message.
 * Confidence 0.85 — slightly below branch-name since a stray commit message is easier to
 * get wrong than a deliberately named branch.
 */
export function extractCommitRefLinks(pullRequests: PullRequest[], commits: Commit[], issues: Issue[], projectKeys: string[]): Link[] {
  const issueIdByKey = new Map(issues.map((i) => [i.key.toUpperCase(), i.id]));
  const links: Link[] = [];

  for (const pr of pullRequests) {
    if (!pr.branch) continue;
    const branchCommits = commits.filter((c) => c.repo === pr.repo && c.branch === pr.branch);
    for (const commit of branchCommits) {
      for (const key of extractIssueKeys(commit.message, projectKeys)) {
        const issueId = issueIdByKey.get(key);
        if (!issueId) continue;
        links.push({ issueId, prId: pr.id, linkSource: "commit_ref", confidence: 0.85 });
      }
    }
  }

  return links;
}
