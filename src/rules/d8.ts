import { businessDaysSince } from "./businessDays.js";
import { isZombieInProgress } from "./d2.js";
import type { Rule } from "./types.js";

/**
 * D8 · Stale board — LOW
 * Issue is in the active sprint, not terminal, not blocked (blocked issues are signal, not
 * drift — they surface in the standup view's Blocked column instead), and hasn't been touched
 * (transition or linked commit) for N business days. Excludes anything D2 already flags
 * (dedupe: D2 wins). drift-rules-spec.md D8.
 *
 * Uses lastTouchedAt (Jira's `updated` timestamp, which moves on comments too) rather than only
 * lastTransitionAt — closer to the spec's "no transition, comment, or linked commit" than D2's
 * transition-only signal, since this field happens to already carry comment activity.
 */
export const d8StaleBoard: Rule = (state, config) => {
  const sprint = state.sprint;
  if (!sprint || sprint.state !== "active") return [];

  const findings = [];
  for (const issue of state.issues) {
    if (issue.sprintId !== sprint.id) continue;
    if (issue.statusCategory === "done" || issue.statusCategory === "blocked") continue;
    if (isZombieInProgress(issue, state, config)) continue; // D2 already covers this one

    const linkedPrIds = new Set(
      state.links.filter((l) => l.issueId === issue.id && l.confidence >= 0.8 && l.linkSource !== "fuzzy").map((l) => l.prId),
    );
    const linkedBranches = new Set(
      state.pullRequests.filter((p) => linkedPrIds.has(p.id)).map((p) => p.branch).filter((b): b is string => Boolean(b)),
    );
    const commitTimes = state.commits.filter((c) => linkedBranches.has(c.branch ?? "")).map((c) => c.committedAt);

    const touchTimes = [issue.lastTouchedAt, ...commitTimes].filter((t): t is string => Boolean(t));
    if (touchTimes.length === 0) continue;

    const lastTouchedAt = touchTimes.reduce((a, b) => (a > b ? a : b));
    const age = businessDaysSince(new Date(lastTouchedAt), config.now);
    if (age < config.d8.days) continue;

    findings.push({
      ruleId: "D8" as const,
      severity: "low" as const,
      entityRefs: [{ issueKey: issue.key }],
      evidence: [{ label: `${issue.key} last touched at ${lastTouchedAt}`, sourceUrl: issue.sourceUrl }],
      message: `${issue.key} hasn't been updated in ${age} working days during an active sprint.`,
      dedupeKey: `D8:${issue.key}`,
    });
  }

  return findings;
};
