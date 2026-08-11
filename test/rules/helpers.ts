import type { CiRun, Commit, Issue, Link, PullRequest, Sprint, TeamState } from "../../src/connectors/types.js";
import { DEFAULT_RULE_CONFIG, type RuleConfig } from "../../src/rules/types.js";

/** Thursday — matches the design-spec.md §1 north-star brief's "Sprint day 6 of 10 ... Thu 6 Aug". */
export const NOW = new Date("2026-08-06T12:00:00.000Z");

export function makeConfig(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return { now: NOW, ...DEFAULT_RULE_CONFIG, ...overrides };
}

export function makeIssue(overrides: Partial<Issue> & { id: string; key: string }): Issue {
  return {
    title: "t",
    status: "In Progress",
    statusCategory: "in_progress",
    sourceUrl: `https://acme.atlassian.net/browse/${overrides.key}`,
    transitions: [],
    ...overrides,
  };
}

export function makePr(overrides: Partial<PullRequest> & { id: string; number: number }): PullRequest {
  return {
    repo: "atlas",
    title: "t",
    state: "open",
    isDraft: false,
    sourceUrl: `https://github.com/acme/atlas/pull/${overrides.number}`,
    reviewers: [],
    reviewEvents: [],
    ...overrides,
  };
}

export function makeCommit(overrides: Partial<Commit> & { id: string; sha: string }): Commit {
  return {
    repo: "atlas",
    message: "wip",
    committedAt: NOW.toISOString(),
    sourceUrl: `https://github.com/acme/atlas/commit/${overrides.sha}`,
    ...overrides,
  };
}

export function makeLink(overrides: Link): Link {
  return overrides;
}

export function makeCiRun(overrides: Partial<CiRun> & { id: string; prId: string }): CiRun {
  return {
    checkName: "ci/build",
    status: "success",
    isRequired: false,
    sourceUrl: `https://github.com/acme/atlas/runs/${overrides.id}`,
    ...overrides,
  };
}

export function makeSprint(overrides: Partial<Sprint> & { id: string }): Sprint {
  return {
    name: "Sprint 6",
    state: "active",
    committedPoints: 30,
    ...overrides,
  };
}

export function makeTeamState(overrides: Partial<TeamState> = {}): TeamState {
  return {
    issues: [],
    pullRequests: [],
    commits: [],
    ciRuns: [],
    people: [],
    sprint: null,
    links: [],
    ...overrides,
  };
}
