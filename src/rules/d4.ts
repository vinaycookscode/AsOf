import { businessDaysSince } from "./businessDays.js";
import type { Rule } from "./types.js";

/**
 * D4 · Orphan work — MEDIUM
 * A branch or commit references an issue that's not in the active sprint, unassigned, or in a
 * terminal status — checked only while that work is still active (a commit in the last N days).
 * drift-rules-spec.md D4.
 *
 * Not linking-gated (D4 isn't in the D1/D2/D6 linking-gate list): any branch_name or commit_ref
 * link counts, since the rule is about the reference existing at all, not trusting it strongly.
 */
export const d4OrphanWork: Rule = (state, config) => {
  const findings = [];

  for (const issue of state.issues) {
    const linkedPrIds = new Set(
      state.links.filter((l) => l.issueId === issue.id && (l.linkSource === "branch_name" || l.linkSource === "commit_ref")).map((l) => l.prId),
    );
    if (linkedPrIds.size === 0) continue;

    const linkedPrs = state.pullRequests.filter((p) => linkedPrIds.has(p.id));
    const linkedBranches = new Set(linkedPrs.map((p) => p.branch).filter((b): b is string => Boolean(b)));
    const branchCommits = state.commits.filter((c) => linkedBranches.has(c.branch ?? ""));
    if (branchCommits.length === 0) continue;

    const mostRecentCommit = branchCommits.reduce((a, b) => (new Date(a.committedAt) > new Date(b.committedAt) ? a : b));
    const age = businessDaysSince(new Date(mostRecentCommit.committedAt), config.now);
    if (age >= config.d4.days) continue; // activity has gone quiet — D4 expires rather than resolves

    const notInSprint = state.sprint?.state === "active" && issue.sprintId !== state.sprint.id;
    const unassigned = !issue.assigneePersonId;
    const terminal = issue.statusCategory === "done";
    if (!notInSprint && !unassigned && !terminal) continue; // not orphaned

    const reason = notInSprint ? "not in the current sprint" : unassigned ? "unassigned" : `marked ${issue.status}`;

    findings.push({
      ruleId: "D4" as const,
      severity: "medium" as const,
      entityRefs: [{ issueKey: issue.key }, { prNumber: linkedPrs[0]!.number, repo: linkedPrs[0]!.repo }],
      evidence: [
        { label: `Commit on ${mostRecentCommit.branch} at ${mostRecentCommit.committedAt} references ${issue.key}`, sourceUrl: mostRecentCommit.sourceUrl },
        { label: `${issue.key} is ${reason}`, sourceUrl: issue.sourceUrl },
      ],
      message: `Active work references ${issue.key}, which is ${reason}.`,
      dedupeKey: `D4:${issue.key}`,
    });
  }

  return findings;
};
