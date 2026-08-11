import { businessDaysSince } from "./businessDays.js";
import type { Rule } from "./types.js";

/**
 * D3 · Silent PR — MEDIUM
 * PR is open, not draft, has requested reviewers, and no review activity for >= X
 * business days since the later of ready-for-review or the last review event
 * (the latter also gives auto-resolve: any new review event resets the clock).
 * drift-rules-spec.md D3.
 */
export const d3SilentPr: Rule = (state, config) => {
  const findings = [];

  for (const pr of state.pullRequests) {
    if (pr.state !== "open" || pr.isDraft) continue;
    if (pr.reviewers.length === 0) continue; // MVP: "review requested" only, no team-wide-review convention yet
    if (pr.authorLogin && config.d3.botAuthorAllowlist.includes(pr.authorLogin)) continue;

    const referenceAt = pr.lastReviewActivityAt ?? pr.readyForReviewAt;
    if (!referenceAt) continue;

    const elapsed = businessDaysSince(new Date(referenceAt), config.now);
    if (elapsed < config.d3.days) continue;

    findings.push({
      ruleId: "D3" as const,
      severity: "medium" as const,
      entityRefs: [{ prNumber: pr.number, repo: pr.repo }],
      evidence: [
        {
          label: `PR #${pr.number} ready for review at ${pr.readyForReviewAt}, requested reviewers: ${pr.reviewers.length}`,
          sourceUrl: pr.sourceUrl,
        },
      ],
      message: `PR #${pr.number} has been awaiting review for ${elapsed} working days with no review activity.`,
      dedupeKey: `D3:${pr.repo}#${pr.number}`,
    });
  }

  return findings;
};
