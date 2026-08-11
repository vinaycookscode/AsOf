import { describe, expect, it } from "vitest";
import { d1DoneButNotMerged } from "../../src/rules/d1.js";
import { makeConfig, makeIssue, makeLink, makePr, makeTeamState, NOW } from "./helpers.js";

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

describe("D1 · Done-but-not-merged", () => {
  it("true positive: Done issue, PR still open, past the 4h grace period", () => {
    const issue = makeIssue({ id: "i1", key: "NOVA-142", statusCategory: "done", status: "Done", lastTransitionAt: hoursAgo(5) });
    const pr = makePr({ id: "pr1", number: 88, state: "open" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link] });

    const findings = d1DoneButNotMerged(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D1", severity: "high", dedupeKey: "D1:NOVA-142" });
    expect(findings[0]!.message).toBe("NOVA-142 is marked Done, but linked PR #88 is still open.");
    expect(findings[0]!.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("boundary: transitioned only 2h ago — still inside the 4h grace period, must NOT fire", () => {
    const issue = makeIssue({ id: "i1", key: "NOVA-142", statusCategory: "done", status: "Done", lastTransitionAt: hoursAgo(2) });
    const pr = makePr({ id: "pr1", number: 88, state: "open" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link] });

    expect(d1DoneButNotMerged(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: issue type is suppressed per team config (e.g. chores), must NOT fire", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-142",
      statusCategory: "done",
      status: "Done",
      issueType: "Chore",
      lastTransitionAt: hoursAgo(5),
    });
    const pr = makePr({ id: "pr1", number: 88, state: "open" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link] });

    const config = makeConfig({ d1: { graceHours: 4, suppressIssueTypes: ["Chore"] } });
    expect(d1DoneButNotMerged(state, config)).toHaveLength(0);
  });

  it("FP trap: fuzzy link never drives a High-severity D1 finding, even above 0.8 confidence", () => {
    const issue = makeIssue({ id: "i1", key: "NOVA-142", statusCategory: "done", status: "Done", lastTransitionAt: hoursAgo(5) });
    const pr = makePr({ id: "pr1", number: 88, state: "open" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "fuzzy", confidence: 0.95 });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link] });

    expect(d1DoneButNotMerged(state, makeConfig())).toHaveLength(0);
  });

  it("resolution: PR merged — the condition no longer holds, must NOT fire", () => {
    const issue = makeIssue({ id: "i1", key: "NOVA-142", statusCategory: "done", status: "Done", lastTransitionAt: hoursAgo(5) });
    const pr = makePr({ id: "pr1", number: 88, state: "merged", mergedAt: hoursAgo(1) });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link] });

    expect(d1DoneButNotMerged(state, makeConfig())).toHaveLength(0);
  });
});
