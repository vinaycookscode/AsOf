import { describe, expect, it } from "vitest";
import { d8StaleBoard } from "../../src/rules/d8.js";
import { makeConfig, makeIssue, makeSprint, makeTeamState } from "./helpers.js";

describe("D8 · Stale board", () => {
  it("true positive: To Do issue in an active sprint, untouched for 5 business days", () => {
    const sprint = makeSprint({ id: "s1" });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-501",
      statusCategory: "other",
      status: "To Do",
      sprintId: "s1",
      lastTouchedAt: "2026-07-30T09:00:00.000Z", // Thursday, prior week
    });
    const state = makeTeamState({ issues: [issue], sprint });

    const findings = d8StaleBoard(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D8", severity: "low", dedupeKey: "D8:NOVA-501" });
    expect(findings[0]!.message).toBe("NOVA-501 hasn't been updated in 5 working days during an active sprint.");
  });

  it("boundary: last touched 3 business days ago, must NOT fire", () => {
    const sprint = makeSprint({ id: "s1" });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-501",
      statusCategory: "other",
      status: "To Do",
      sprintId: "s1",
      lastTouchedAt: "2026-08-03T09:00:00.000Z", // Monday
    });
    const state = makeTeamState({ issues: [issue], sprint });

    expect(d8StaleBoard(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: issue is Blocked — signal, not drift — must NOT fire", () => {
    const sprint = makeSprint({ id: "s1" });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-501",
      statusCategory: "blocked",
      status: "Blocked",
      sprintId: "s1",
      lastTouchedAt: "2026-07-30T09:00:00.000Z",
    });
    const state = makeTeamState({ issues: [issue], sprint });

    expect(d8StaleBoard(state, makeConfig())).toHaveLength(0);
  });

  it("dedupe: D2 already flags this issue as a zombie, D8 must NOT also fire", () => {
    const sprint = makeSprint({ id: "s1" });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-501",
      statusCategory: "in_progress",
      status: "In Progress",
      sprintId: "s1",
      lastTransitionAt: "2026-07-30T09:00:00.000Z",
      lastTouchedAt: "2026-07-30T09:00:00.000Z",
    });
    const state = makeTeamState({ issues: [issue], sprint });

    expect(d8StaleBoard(state, makeConfig())).toHaveLength(0);
  });
});
