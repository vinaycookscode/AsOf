import { describe, expect, it } from "vitest";
import type { Commit, Issue, PullRequest } from "../../src/connectors/types.js";
import { extractExplicitLinks } from "../../src/linking/explicit.js";
import { extractBranchNameLinks, extractCommitRefLinks } from "../../src/linking/implicit.js";
import { extractIssueKeys } from "../../src/linking/keys.js";
import { mergeLinks, resolveLinks } from "../../src/linking/index.js";

const projectKeys = ["NOVA"];

function issue(overrides: Partial<Issue> & { id: string; key: string }): Issue {
  return {
    title: "t",
    status: "In Progress",
    statusCategory: "in_progress",
    sourceUrl: `https://acme.atlassian.net/browse/${overrides.key}`,
    transitions: [],
    ...overrides,
  };
}

function pr(overrides: Partial<PullRequest> & { id: string; number: number }): PullRequest {
  return {
    repo: "atlas",
    title: "t",
    state: "open",
    isDraft: false,
    sourceUrl: `https://github.com/acme/atlas/pull/${overrides.number}`,
    reviewers: [],
    reviewEvents: [],
    ...overrides,
  };
}

function commit(overrides: Partial<Commit> & { id: string; sha: string; message: string }): Commit {
  return {
    repo: "atlas",
    committedAt: "2026-08-05T10:00:00.000Z",
    sourceUrl: `https://github.com/acme/atlas/commit/${overrides.sha}`,
    ...overrides,
  };
}

describe("extractIssueKeys", () => {
  it("filters to connected project keys only (FP trap: cross-project keys)", () => {
    expect(extractIssueKeys("Fixes NOVA-142 and OTHER-9", ["NOVA"])).toEqual(["NOVA-142"]);
  });

  it("matches lowercase keys in branch names case-insensitively", () => {
    expect(extractIssueKeys("priya/nova-142-rate-limit", ["NOVA"])).toEqual(["NOVA-142"]);
  });
});

describe("extractExplicitLinks", () => {
  const nova142 = issue({ id: "issue-1", key: "NOVA-142" });

  it("links on a closing keyword in the PR title", () => {
    const p = pr({ id: "pr-1", number: 88, title: "Closes NOVA-142: merge ticket" });
    const links = extractExplicitLinks([p], [nova142], projectKeys);
    expect(links).toEqual([{ issueId: "issue-1", prId: "pr-1", linkSource: "explicit", confidence: 1.0 }]);
  });

  it("links on a closing keyword in the PR body, not just title", () => {
    const p = pr({ id: "pr-1", number: 88, title: "Auth refactor", body: "This fixes NOVA-142." });
    const links = extractExplicitLinks([p], [nova142], projectKeys);
    expect(links).toHaveLength(1);
  });

  it("does NOT link a bare key mention with no closing keyword", () => {
    const p = pr({ id: "pr-1", number: 88, title: "Related to NOVA-142 but not done" });
    const links = extractExplicitLinks([p], [nova142], projectKeys);
    expect(links).toHaveLength(0);
  });

  it("does not link a key for an issue outside the connected project", () => {
    const p = pr({ id: "pr-1", number: 88, title: "Closes OTHER-9" });
    const links = extractExplicitLinks([p], [nova142], projectKeys);
    expect(links).toHaveLength(0);
  });
});

describe("extractBranchNameLinks", () => {
  it("links when the branch name encodes an issue key", () => {
    const nova142 = issue({ id: "issue-1", key: "NOVA-142" });
    const p = pr({ id: "pr-1", number: 88, branch: "priya/nova-142-rate-limit" });
    const links = extractBranchNameLinks([p], [nova142], projectKeys);
    expect(links).toEqual([{ issueId: "issue-1", prId: "pr-1", linkSource: "branch_name", confidence: 0.9 }]);
  });

  it("does not link when the branch has no issue key", () => {
    const nova142 = issue({ id: "issue-1", key: "NOVA-142" });
    const p = pr({ id: "pr-1", number: 88, branch: "hotfix/typo" });
    expect(extractBranchNameLinks([p], [nova142], projectKeys)).toHaveLength(0);
  });
});

describe("extractCommitRefLinks", () => {
  it("links when a commit on the PR's branch mentions an issue key", () => {
    const nova142 = issue({ id: "issue-1", key: "NOVA-142" });
    const p = pr({ id: "pr-1", number: 88, branch: "priya/rate-limit" });
    const c = commit({ id: "c1", sha: "abc", branch: "priya/rate-limit", message: "wip on NOVA-142" });
    const links = extractCommitRefLinks([p], [c], [nova142], projectKeys);
    expect(links).toEqual([{ issueId: "issue-1", prId: "pr-1", linkSource: "commit_ref", confidence: 0.85 }]);
  });

  it("ignores commits on a different branch than the PR's", () => {
    const nova142 = issue({ id: "issue-1", key: "NOVA-142" });
    const p = pr({ id: "pr-1", number: 88, branch: "priya/rate-limit" });
    const c = commit({ id: "c1", sha: "abc", branch: "other-branch", message: "wip on NOVA-142" });
    expect(extractCommitRefLinks([p], [c], [nova142], projectKeys)).toHaveLength(0);
  });
});

describe("mergeLinks", () => {
  it("keeps the highest-confidence link when sources agree on the same issue-PR pair", () => {
    const links = mergeLinks([
      { issueId: "issue-1", prId: "pr-1", linkSource: "commit_ref", confidence: 0.85 },
      { issueId: "issue-1", prId: "pr-1", linkSource: "explicit", confidence: 1.0 },
    ]);
    expect(links).toEqual([{ issueId: "issue-1", prId: "pr-1", linkSource: "explicit", confidence: 1.0 }]);
  });
});

describe("resolveLinks", () => {
  it("combines explicit, branch_name, and commit_ref sources end-to-end", () => {
    const nova142 = issue({ id: "issue-1", key: "NOVA-142" });
    const nova150 = issue({ id: "issue-2", key: "NOVA-150" });
    const p1 = pr({ id: "pr-1", number: 88, title: "Closes NOVA-142" });
    const p2 = pr({ id: "pr-2", number: 91, branch: "wei/nova-150-review" });
    const links = resolveLinks([p1, p2], [], [nova142, nova150], projectKeys);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.prId === "pr-1")).toMatchObject({ linkSource: "explicit" });
    expect(links.find((l) => l.prId === "pr-2")).toMatchObject({ linkSource: "branch_name" });
  });
});
