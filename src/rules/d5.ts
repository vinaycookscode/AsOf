import type { Rule } from "./types.js";

/**
 * D5 · Review overload — MEDIUM
 * One person is a requested reviewer on more than K open, non-draft PRs, counted across
 * connected repos. Weighted so CODEOWNERS-style shared-reviewer bots don't inflate the count:
 * solo requests count 1.0, shared requests count 0.5. drift-rules-spec.md D5.
 */
export const d5ReviewOverload: Rule = (state, config) => {
  const openPrs = state.pullRequests.filter((p) => p.state === "open" && !p.isDraft);

  const byReviewer = new Map<string, { weight: number; prs: typeof openPrs }>();
  for (const pr of openPrs) {
    for (const reviewer of pr.reviewers) {
      const entry = byReviewer.get(reviewer.personId) ?? { weight: 0, prs: [] };
      entry.weight += reviewer.isSoloRequest ? 1 : 0.5;
      entry.prs.push(pr);
      byReviewer.set(reviewer.personId, entry);
    }
  }

  const findings = [];
  for (const [personId, { weight, prs }] of byReviewer) {
    if (weight <= config.d5.maxOpenReviews) continue;

    findings.push({
      ruleId: "D5" as const,
      severity: "medium" as const,
      entityRefs: [{ personId }, ...prs.map((p) => ({ prNumber: p.number, repo: p.repo }))],
      evidence: prs.map((p) => ({ label: `PR #${p.number} awaiting review`, sourceUrl: p.sourceUrl })),
      message: `${prs.length} open PRs are currently waiting on review from the same person.`,
      dedupeKey: `D5:${personId}`,
    });
  }

  return findings;
};
