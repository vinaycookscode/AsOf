import type { Rule } from "./types.js";

/**
 * D7 · Scope creep — LOW (sprint-level)
 * Points added to the active sprint after it started exceed a threshold % of committed points.
 * drift-rules-spec.md D7.
 *
 * Points-only: the spec's "or count, if the team doesn't estimate" fallback needs a committed
 * *issue count* baseline the Sprint model doesn't carry (only committedPoints) — out of scope
 * here, same kind of documented gap as D2's comments gap. Teams without points won't get D7.
 */
export const d7ScopeCreep: Rule = (state, config) => {
  const sprint = state.sprint;
  if (!sprint || sprint.state !== "active" || !sprint.startAt) return [];
  if (sprint.committedPoints <= 0) return [];

  const addedIssues = state.issues.filter(
    (i) => i.sprintId === sprint.id && i.addedToSprintAt && new Date(i.addedToSprintAt) > new Date(sprint.startAt!),
  );
  if (addedIssues.length === 0) return [];

  const addedPoints = addedIssues.reduce((sum, i) => sum + (i.points ?? 0), 0);
  const pct = (addedPoints / sprint.committedPoints) * 100;
  if (pct <= config.d7.thresholdPct) return [];

  return [
    {
      ruleId: "D7" as const,
      severity: "low" as const,
      entityRefs: addedIssues.map((i) => ({ issueKey: i.key })),
      evidence: addedIssues.map((i) => ({
        label: `${i.key} (${i.points ?? 0} pts) added to the sprint at ${i.addedToSprintAt}`,
        sourceUrl: i.sourceUrl,
      })),
      message: `${addedPoints} points (${Math.round(pct)}%) have been added to the sprint since it started (committed: ${sprint.committedPoints}).`,
      dedupeKey: `D7:${sprint.id}`,
    },
  ];
};
