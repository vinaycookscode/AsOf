import { describe, expect, it } from "vitest";
import { d7ScopeCreep } from "../../src/rules/d7.js";
import { makeConfig, makeIssue, makeSprint, makeTeamState } from "./helpers.js";

const SPRINT_START = "2026-08-03T09:00:00.000Z"; // Monday

describe("D7 · Scope creep", () => {
  it("true positive: 8 points added after sprint start, 27% of 30 committed (> 20%)", () => {
    const sprint = makeSprint({ id: "s1", startAt: SPRINT_START, committedPoints: 30 });
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-401",
      sprintId: "s1",
      points: 8,
      addedToSprintAt: "2026-08-04T09:00:00.000Z", // Tuesday, after start
    });
    const state = makeTeamState({ issues: [issue], sprint });

    const findings = d7ScopeCreep(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D7", severity: "low", dedupeKey: "D7:s1" });
    expect(findings[0]!.message).toBe("8 points (27%) have been added to the sprint since it started (committed: 30).");
  });

  it("boundary: 6 points added is exactly 20% of 30 committed, must NOT fire", () => {
    const sprint = makeSprint({ id: "s1", startAt: SPRINT_START, committedPoints: 30 });
    const issue = makeIssue({ id: "i1", key: "NOVA-401", sprintId: "s1", points: 6, addedToSprintAt: "2026-08-04T09:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], sprint });

    expect(d7ScopeCreep(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: issue added before sprint start (planned intake, not creep), must NOT fire", () => {
    const sprint = makeSprint({ id: "s1", startAt: SPRINT_START, committedPoints: 30 });
    const issue = makeIssue({ id: "i1", key: "NOVA-401", sprintId: "s1", points: 20, addedToSprintAt: "2026-08-02T09:00:00.000Z" }); // Sunday, before start
    const state = makeTeamState({ issues: [issue], sprint });

    expect(d7ScopeCreep(state, makeConfig())).toHaveLength(0);
  });

  it("resolution: sprint has closed, must NOT fire even with the same over-threshold intake", () => {
    const sprint = makeSprint({ id: "s1", startAt: SPRINT_START, committedPoints: 30, state: "closed" });
    const issue = makeIssue({ id: "i1", key: "NOVA-401", sprintId: "s1", points: 8, addedToSprintAt: "2026-08-04T09:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], sprint });

    expect(d7ScopeCreep(state, makeConfig())).toHaveLength(0);
  });
});
