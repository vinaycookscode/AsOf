import type { Rule } from "./types.js";

/**
 * D1 · Done-but-not-merged — HIGH
 * issue is Done AND its linked PR is still open, past a grace period for the
 * "moved the ticket seconds before merging" case. drift-rules-spec.md D1.
 */
export const d1DoneButNotMerged: Rule = (state, config) => {
  const issueById = new Map(state.issues.map((i) => [i.id, i]));
  const prById = new Map(state.pullRequests.map((p) => [p.id, p]));
  const graceMs = config.d1.graceHours * 60 * 60 * 1000;

  return state.links.flatMap((link) => {
    // Linking gate: fuzzy links, and anything below 0.8 confidence, never drive High severity.
    if (link.confidence < 0.8 || link.linkSource === "fuzzy") return [];

    const issue = issueById.get(link.issueId);
    const pr = prById.get(link.prId);
    if (!issue || !pr) return [];

    if (issue.statusCategory !== "done") return [];
    if (pr.state !== "open") return []; // covers both draft and ready-for-review, per spec's {open, draft}
    if (config.d1.suppressIssueTypes.includes(issue.issueType ?? "")) return [];
    if (!issue.lastTransitionAt) return [];

    const transitionedAt = new Date(issue.lastTransitionAt);
    if (config.now.getTime() - transitionedAt.getTime() < graceMs) return [];

    return [
      {
        ruleId: "D1" as const,
        severity: "high" as const,
        entityRefs: [{ issueKey: issue.key }, { prNumber: pr.number, repo: pr.repo }],
        evidence: [
          { label: `${issue.key} moved to ${issue.status} at ${issue.lastTransitionAt}`, sourceUrl: issue.sourceUrl },
          { label: `PR #${pr.number} is ${pr.state}`, sourceUrl: pr.sourceUrl },
        ],
        message: `${issue.key} is marked ${issue.status}, but linked PR #${pr.number} is still ${pr.state}.`,
        dedupeKey: `D1:${issue.key}`,
      },
    ];
  });
};
