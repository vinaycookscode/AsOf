import { businessDaysSince } from "./businessDays.js";
import type { Issue, TeamState } from "../connectors/types.js";
import type { Rule, RuleConfig } from "./types.js";

/**
 * True when `issue` matches D2's zombie-in-progress condition. Exported so D8 (Stale board) can
 * exclude issues D2 already covers per its "dedupe: D2 wins" rule, without D8 calling the D2
 * Rule function itself — rules never call other rules (README invariant #1); this is a shared
 * pure predicate, same category as businessDaysSince.
 */
export function isZombieInProgress(issue: Issue, state: TeamState, config: RuleConfig): boolean {
  if (issue.statusCategory !== "in_progress") return false;
  if (!issue.lastTransitionAt) return false;

  const transitionedAt = new Date(issue.lastTransitionAt);
  const age = businessDaysSince(transitionedAt, config.now);
  if (age < config.d2.days) return false;

  // Linking gate (D2 is listed): below 0.8 confidence or fuzzy links don't count as "linked work".
  const linkedPrIds = new Set(
    state.links.filter((l) => l.issueId === issue.id && l.confidence >= 0.8 && l.linkSource !== "fuzzy").map((l) => l.prId),
  );
  const linkedPrs = state.pullRequests.filter((p) => linkedPrIds.has(p.id));
  const linkedBranches = new Set(linkedPrs.map((p) => p.branch).filter((b): b is string => Boolean(b)));

  const hasRecentCommit = state.commits.some(
    (c) => linkedBranches.has(c.branch ?? "") && new Date(c.committedAt) > transitionedAt,
  );
  return !hasRecentCommit;
}

/**
 * D2 · Zombie In-Progress — HIGH
 * issue has sat In Progress for >= N business days with no commit on its linked
 * branch(es) since the transition. drift-rules-spec.md D2.
 *
 * Known P3 scope gap: Jira comments are not pulled by the B3 connector (metadata only,
 * no comment fetch yet), so "no comments" in the spec's condition is not checked here —
 * only transitions (via lastTransitionAt) and linked-branch commit activity.
 */
export const d2ZombieInProgress: Rule = (state, config) => {
  const findings = [];

  for (const issue of state.issues) {
    if (!isZombieInProgress(issue, state, config)) continue;

    const transitionedAt = new Date(issue.lastTransitionAt!);
    const age = businessDaysSince(transitionedAt, config.now);
    const linkedPrIds = new Set(
      state.links.filter((l) => l.issueId === issue.id && l.confidence >= 0.8 && l.linkSource !== "fuzzy").map((l) => l.prId),
    );
    const linkedPrs = state.pullRequests.filter((p) => linkedPrIds.has(p.id));
    const linkedBranches = new Set(linkedPrs.map((p) => p.branch).filter((b): b is string => Boolean(b)));

    const evidence = [
      { label: `${issue.key} last transitioned to ${issue.status} at ${issue.lastTransitionAt}`, sourceUrl: issue.sourceUrl },
    ];
    evidence.push(
      linkedBranches.size > 0
        ? { label: `No commits on ${[...linkedBranches].join(", ")} since the transition`, sourceUrl: linkedPrs[0]!.sourceUrl }
        : { label: "No linked branch found", sourceUrl: issue.sourceUrl },
    );

    findings.push({
      ruleId: "D2" as const,
      severity: "high" as const,
      entityRefs: [{ issueKey: issue.key }],
      evidence,
      message: `${issue.key} has shown no recorded activity for ${age} working days while In Progress.`,
      dedupeKey: `D2:${issue.key}`,
    });
  }

  return findings;
};
