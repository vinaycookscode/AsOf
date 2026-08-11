import { describe, expect, it } from "vitest";
import { d5ReviewOverload } from "../../src/rules/d5.js";
import { makeConfig, makePr, makeTeamState } from "./helpers.js";

function soloPrs(count: number, personId = "p1") {
  return Array.from({ length: count }, (_, i) =>
    makePr({ id: `pr${i}`, number: 100 + i, reviewers: [{ personId, isSoloRequest: true }] }),
  );
}

describe("D5 · Review overload", () => {
  it("true positive: 5 solo-requested open PRs (weight 5 > 4)", () => {
    const state = makeTeamState({ pullRequests: soloPrs(5) });

    const findings = d5ReviewOverload(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D5", severity: "medium", dedupeKey: "D5:p1" });
    expect(findings[0]!.message).toBe("5 open PRs are currently waiting on review from the same person.");
  });

  it("boundary: exactly 4 solo-requested PRs (weight 4, not > 4), must NOT fire", () => {
    const state = makeTeamState({ pullRequests: soloPrs(4) });

    expect(d5ReviewOverload(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: 7 shared-reviewer PRs (weight 3.5, CODEOWNERS-style) stays under threshold, must NOT fire", () => {
    const prs = Array.from({ length: 7 }, (_, i) =>
      makePr({ id: `pr${i}`, number: 100 + i, reviewers: [{ personId: "p1", isSoloRequest: false }] }),
    );
    const state = makeTeamState({ pullRequests: prs });

    expect(d5ReviewOverload(state, makeConfig())).toHaveLength(0);
  });

  it("resolution: one of the 5 overloading PRs merged, leaving 4 open (weight 4), must NOT fire", () => {
    const prs = soloPrs(5);
    prs[0]!.state = "merged";
    const state = makeTeamState({ pullRequests: prs });

    expect(d5ReviewOverload(state, makeConfig())).toHaveLength(0);
  });
});
