import type { Rule } from "./types.js";

/**
 * D6 · Red-but-moving — HIGH
 * The latest CI run on a linked PR is failing, and the linked issue moved forward after the
 * failure started. drift-rules-spec.md D6.
 *
 * "Forward" per README invariant #4 (rules read statusCategory, never raw status strings): we
 * can't reconstruct the team's full workflow order from per-transition raw labels without a
 * status->category map the rule layer doesn't have, so "forward" here means the issue's
 * *current* category is in_progress or done (i.e. it didn't move backward to blocked/other) and
 * its last transition happened after the failing run started — same category+lastTransitionAt
 * pattern D1/D2 already use for this reason.
 */
export const d6RedButMoving: Rule = (state, config) => {
  const issueById = new Map(state.issues.map((i) => [i.id, i]));
  const prById = new Map(state.pullRequests.map((p) => [p.id, p]));

  return state.links.flatMap((link) => {
    // Linking gate (D6 is listed): below 0.8 confidence or fuzzy links don't count.
    if (link.confidence < 0.8 || link.linkSource === "fuzzy") return [];

    const issue = issueById.get(link.issueId);
    const pr = prById.get(link.prId);
    if (!issue || !pr) return [];
    if (issue.statusCategory !== "in_progress" && issue.statusCategory !== "done") return [];
    if (!issue.lastTransitionAt) return [];

    const runs = state.ciRuns
      .filter((r) => r.prId === pr.id)
      .filter((r) => !config.d6.flakyCheckAllowlist.includes(r.checkName));
    if (runs.length === 0) return [];

    // Prefer required checks when the API exposed any; otherwise fall back to all checks.
    const relevantRuns = runs.some((r) => r.isRequired) ? runs.filter((r) => r.isRequired) : runs;
    const latestRun = relevantRuns.reduce((a, b) => {
      const aAt = a.completedAt ?? a.startedAt ?? "";
      const bAt = b.completedAt ?? b.startedAt ?? "";
      return aAt > bAt ? a : b;
    });
    if (latestRun.status !== "failure") return [];

    const failureStartedAt = latestRun.startedAt ?? latestRun.completedAt;
    if (!failureStartedAt) return [];

    const transitionedAt = new Date(issue.lastTransitionAt);
    if (transitionedAt <= new Date(failureStartedAt)) return []; // transition predates the failure

    return [
      {
        ruleId: "D6" as const,
        severity: "high" as const,
        entityRefs: [{ issueKey: issue.key }, { prNumber: pr.number, repo: pr.repo }],
        evidence: [
          { label: `${latestRun.checkName} is ${latestRun.status} on PR #${pr.number}`, sourceUrl: latestRun.sourceUrl },
          { label: `${issue.key} moved to ${issue.status} at ${issue.lastTransitionAt}`, sourceUrl: issue.sourceUrl },
        ],
        message: `${issue.key} moved forward to ${issue.status} while CI on PR #${pr.number} is failing (${latestRun.checkName}).`,
        dedupeKey: `D6:${issue.key}`,
      },
    ];
  });
};
