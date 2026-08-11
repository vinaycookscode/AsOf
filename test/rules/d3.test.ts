import { describe, expect, it } from "vitest";
import { d3SilentPr } from "../../src/rules/d3.js";
import { makeConfig, makePr, makeTeamState } from "./helpers.js";

describe("D3 · Silent PR", () => {
  it("true positive: ready for review Tuesday, no review activity by Thursday (2 business days)", () => {
    const pr = makePr({
      id: "pr1",
      number: 91,
      readyForReviewAt: "2026-08-04T13:00:00.000Z", // Tuesday afternoon
      reviewers: [{ personId: "p1", isSoloRequest: false }, { personId: "p2", isSoloRequest: false }],
    });
    const state = makeTeamState({ pullRequests: [pr] });

    const findings = d3SilentPr(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D3", severity: "medium", dedupeKey: "D3:atlas#91" });
    expect(findings[0]!.message).toBe("PR #91 has been awaiting review for 2 working days with no review activity.");
  });

  it("boundary: ready for review Wednesday — only 1 business day elapsed by Thursday, must NOT fire", () => {
    const pr = makePr({
      id: "pr1",
      number: 91,
      readyForReviewAt: "2026-08-05T13:00:00.000Z", // Wednesday afternoon
      reviewers: [{ personId: "p1", isSoloRequest: true }],
    });
    const state = makeTeamState({ pullRequests: [pr] });

    expect(d3SilentPr(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: bot author on the allowlist, must NOT fire", () => {
    const pr = makePr({
      id: "pr1",
      number: 91,
      authorLogin: "dependabot[bot]",
      readyForReviewAt: "2026-08-04T13:00:00.000Z",
      reviewers: [{ personId: "p1", isSoloRequest: true }],
    });
    const state = makeTeamState({ pullRequests: [pr] });

    expect(d3SilentPr(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: draft PRs are excluded even with stale reviewers", () => {
    const pr = makePr({
      id: "pr1",
      number: 91,
      isDraft: true,
      readyForReviewAt: "2026-08-04T13:00:00.000Z",
      reviewers: [{ personId: "p1", isSoloRequest: true }],
    });
    const state = makeTeamState({ pullRequests: [pr] });

    expect(d3SilentPr(state, makeConfig())).toHaveLength(0);
  });

  it("resolution: a review event landed within the threshold window, must NOT fire", () => {
    const pr = makePr({
      id: "pr1",
      number: 91,
      readyForReviewAt: "2026-08-01T13:00:00.000Z", // far in the past
      lastReviewActivityAt: "2026-08-05T13:00:00.000Z", // Wednesday — resets the clock
      reviewers: [{ personId: "p1", isSoloRequest: true }],
    });
    const state = makeTeamState({ pullRequests: [pr] });

    expect(d3SilentPr(state, makeConfig())).toHaveLength(0);
  });
});
