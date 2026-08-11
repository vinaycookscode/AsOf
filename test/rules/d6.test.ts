import { describe, expect, it } from "vitest";
import { d6RedButMoving } from "../../src/rules/d6.js";
import { makeCiRun, makeConfig, makeIssue, makeLink, makePr, makeTeamState } from "./helpers.js";

describe("D6 · Red-but-moving", () => {
  it("true positive: issue moved forward after CI started failing", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-310",
      statusCategory: "in_progress",
      status: "In Review",
      lastTransitionAt: "2026-08-05T10:00:00.000Z", // Wednesday
    });
    const pr = makePr({ id: "pr1", number: 55 });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const run = makeCiRun({ id: "r1", prId: "pr1", checkName: "ci/test", status: "failure", startedAt: "2026-08-05T08:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], ciRuns: [run] });

    const findings = d6RedButMoving(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D6", severity: "high", dedupeKey: "D6:NOVA-310" });
    expect(findings[0]!.message).toBe("NOVA-310 moved forward to In Review while CI on PR #55 is failing (ci/test).");
  });

  it("boundary: transition at the exact same instant CI started failing, must NOT fire", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-310",
      statusCategory: "in_progress",
      status: "In Review",
      lastTransitionAt: "2026-08-05T08:00:00.000Z",
    });
    const pr = makePr({ id: "pr1", number: 55 });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const run = makeCiRun({ id: "r1", prId: "pr1", checkName: "ci/test", status: "failure", startedAt: "2026-08-05T08:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], ciRuns: [run] });

    expect(d6RedButMoving(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: failing check is on the flaky-check allowlist, must NOT fire", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-310",
      statusCategory: "in_progress",
      status: "In Review",
      lastTransitionAt: "2026-08-05T10:00:00.000Z",
    });
    const pr = makePr({ id: "pr1", number: 55 });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const run = makeCiRun({ id: "r1", prId: "pr1", checkName: "ci/flaky-e2e", status: "failure", startedAt: "2026-08-05T08:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], ciRuns: [run] });

    const config = makeConfig({ d6: { flakyCheckAllowlist: ["ci/flaky-e2e"] } });
    expect(d6RedButMoving(state, config)).toHaveLength(0);
  });

  it("resolution: a later run on the same check is green, must NOT fire", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-310",
      statusCategory: "in_progress",
      status: "In Review",
      lastTransitionAt: "2026-08-05T10:00:00.000Z",
    });
    const pr = makePr({ id: "pr1", number: 55 });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const failedRun = makeCiRun({
      id: "r1",
      prId: "pr1",
      checkName: "ci/test",
      status: "failure",
      startedAt: "2026-08-05T08:00:00.000Z",
      completedAt: "2026-08-05T08:05:00.000Z",
    });
    const fixedRun = makeCiRun({
      id: "r2",
      prId: "pr1",
      checkName: "ci/test",
      status: "success",
      startedAt: "2026-08-05T11:00:00.000Z",
      completedAt: "2026-08-05T11:05:00.000Z",
    });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], ciRuns: [failedRun, fixedRun] });

    expect(d6RedButMoving(state, makeConfig())).toHaveLength(0);
  });
});
