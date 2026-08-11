import { describe, expect, it } from "vitest";
import { d2ZombieInProgress } from "../../src/rules/d2.js";
import { makeCommit, makeConfig, makeIssue, makeLink, makePr, makeTeamState } from "./helpers.js";

describe("D2 · Zombie In-Progress", () => {
  it("true positive: In Progress since Monday, no linked branch, now Thursday (3 business days)", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-137",
      statusCategory: "in_progress",
      status: "In Progress",
      lastTransitionAt: "2026-08-03T09:00:00.000Z", // Monday
    });
    const state = makeTeamState({ issues: [issue] });

    const findings = d2ZombieInProgress(state, makeConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "D2", severity: "high", dedupeKey: "D2:NOVA-137" });
    expect(findings[0]!.message).toBe("NOVA-137 has shown no recorded activity for 3 working days while In Progress.");
  });

  it("boundary: transitioned Tuesday — only 2 business days elapsed by Thursday, must NOT fire", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-137",
      statusCategory: "in_progress",
      status: "In Progress",
      lastTransitionAt: "2026-08-04T13:00:00.000Z", // Tuesday afternoon
    });
    const state = makeTeamState({ issues: [issue] });

    expect(d2ZombieInProgress(state, makeConfig())).toHaveLength(0);
  });

  it("FP trap: a low-confidence (fuzzy) link is ignored by the linking gate, so its commit doesn't count — but a real high-confidence link's commit does, and correctly suppresses the finding", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-137",
      statusCategory: "in_progress",
      status: "In Progress",
      lastTransitionAt: "2026-08-03T09:00:00.000Z",
    });
    const stalePr = makePr({ id: "pr-stale", number: 1, branch: "someone/guess" });
    const activePr = makePr({ id: "pr-active", number: 2, branch: "priya/nova-137" });
    const staleLink = makeLink({ issueId: "i1", prId: "pr-stale", linkSource: "fuzzy", confidence: 0.9 });
    const activeLink = makeLink({ issueId: "i1", prId: "pr-active", linkSource: "branch_name", confidence: 0.9 });
    const commit = makeCommit({ id: "c1", sha: "abc", branch: "priya/nova-137", committedAt: "2026-08-05T10:00:00.000Z" });
    const state = makeTeamState({
      issues: [issue],
      pullRequests: [stalePr, activePr],
      links: [staleLink, activeLink],
      commits: [commit],
    });

    expect(d2ZombieInProgress(state, makeConfig())).toHaveLength(0);
  });

  it("resolution: a commit lands on the linked branch after the transition, must NOT fire", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-137",
      statusCategory: "in_progress",
      status: "In Progress",
      lastTransitionAt: "2026-08-03T09:00:00.000Z",
    });
    const pr = makePr({ id: "pr1", number: 1, branch: "priya/nova-137" });
    const link = makeLink({ issueId: "i1", prId: "pr1", linkSource: "explicit", confidence: 1.0 });
    const commit = makeCommit({ id: "c1", sha: "abc", branch: "priya/nova-137", committedAt: "2026-08-04T10:00:00.000Z" });
    const state = makeTeamState({ issues: [issue], pullRequests: [pr], links: [link], commits: [commit] });

    expect(d2ZombieInProgress(state, makeConfig())).toHaveLength(0);
  });

  it("does not fire on issues outside in_progress", () => {
    const issue = makeIssue({
      id: "i1",
      key: "NOVA-137",
      statusCategory: "blocked",
      status: "Blocked",
      lastTransitionAt: "2026-08-03T09:00:00.000Z",
    });
    const state = makeTeamState({ issues: [issue] });
    expect(d2ZombieInProgress(state, makeConfig())).toHaveLength(0);
  });
});
