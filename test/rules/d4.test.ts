import { describe, expect, it } from "vitest";
import { d4OrphanWork } from "../../src/rules/d4.js";
import { makeCommit, makeConfig, makeIssue, makeLink, makePr, makeSprint, makeTeamState } from "./helpers.js";

describe("D4 · Orphan work", () => {
  it("true positive: unassigned issue with a branch-linked commit yesterday (1 business day)", () => {
    const issue = makeIssue({ id: "i1", key: "NOVA-201", statusCategory: "in_progress", status: "In Progress" });
    const pr = makePr({ id: "pr1", number: 12, branch: "priya/nova-201" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "branch_name", confidence: 0.9 });
    const commit = makeCommit({ id: "c1", sha: "abc", branch: "priya/nova-201", committedAt: "2026-08-05T10:00:00.000Z" }); // Wednesday
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], commits: [commit] });

    const findings = d4OrphanWork(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D4", severity: "medium", dedupeKey: "D4:NOVA-201" });
    expect(findings[0]!.message).toBe("Active work references NOVA-201, which is unassigned.");
  });

  it("boundary: most recent commit is exactly 2 business days old, must NOT fire (activity expired)", () => {
    const issue = makeIssue({ id: "i1", key: "NOVA-201", statusCategory: "in_progress", status: "In Progress" });
    const pr = makePr({ id: "pr1", number: 12, branch: "priya/nova-201" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "branch_name", confidence: 0.9 });
    const commit = makeCommit({ id: "c1", sha: "abc", branch: "priya/nova-201", committedAt: "2026-08-04T13:00:00.000Z" }); // Tuesday
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], commits: [commit] });

    expect(d4OrphanWork(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: assigned, in the active sprint, not terminal — recent commit but not orphaned, must NOT fire", () => {
    const sprint = makeSprint({ id: "s1" });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-201",
      statusCategory: "in_progress",
      status: "In Progress",
      assigneePersonId: "p1",
      sprintId: "s1",
    });
    const pr = makePr({ id: "pr1", number: 12, branch: "priya/nova-201" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "branch_name", confidence: 0.9 });
    const commit = makeCommit({ id: "c1", sha: "abc", branch: "priya/nova-201", committedAt: "2026-08-05T10:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], commits: [commit], sprint });

    expect(d4OrphanWork(state, makeConfig())).toHaveLength(0);
  });

  it("resolution: issue reopened out of a terminal status, now assigned and sprinted, must NOT fire", () => {
    const sprint = makeSprint({ id: "s1" });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-201",
      statusCategory: "in_progress", // was "done" when it first fired; now reopened
      status: "In Progress",
      assigneePersonId: "p1",
      sprintId: "s1",
    });
    const pr = makePr({ id: "pr1", number: 12, branch: "priya/nova-201" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "commit_ref", confidence: 0.85 });
    const commit = makeCommit({ id: "c1", sha: "abc", branch: "priya/nova-201", committedAt: "2026-08-05T10:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], commits: [commit], sprint });

    expect(d4OrphanWork(state, makeConfig())).toHaveLength(0);
  });
});
