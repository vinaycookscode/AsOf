import type { Commit, Issue, Person, PullRequest, Sprint } from "../../src/connectors/types.js";

/**
 * Demo/prototype-verification fixture, modeled on the north-star brief (design-spec.md §1):
 * NOVA-142 (D1), NOVA-137 (D2), PR #91 blocking NOVA-150 (D3), plus a "since yesterday" story
 * (merges, moves, and a D1 on NOVA-129 that phase 2 resolves).
 *
 * This is NOT the P3 GO/NO-GO gate (drift-rules-spec.md B14 requires a real team's data and a
 * lead's judgment) — it exists so the sync -> drift -> brief pipeline is runnable and verifiable
 * without live Jira/GitHub/Anthropic credentials.
 */

export const DEMO_PROJECT_KEYS = ["NOVA"];
export const DEMO_REPO = "atlas";
export const DEMO_TEAM_NAME = "Atlas squad";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const priya: Person = { id: "demo-priya", displayName: "Priya", email: "priya@acme.com", jiraAccountId: "acc-priya", githubLogin: "priya" };
const wei: Person = { id: "demo-wei", displayName: "Wei", email: "wei@acme.com", jiraAccountId: "acc-wei", githubLogin: "wei" };
const sam: Person = { id: "demo-sam", displayName: "Sam", email: "sam@acme.com", jiraAccountId: "acc-sam", githubLogin: "sam" };

export interface DemoBundle {
  people: Person[];
  issues: Issue[];
  pullRequests: PullRequest[];
  commits: Commit[];
  sprint: Sprint;
}

/** phase 2 merges PR #84 (resolving the D1 on NOVA-129) — everything else is unchanged. */
export function buildDemoBundle(now: Date, phase: 1 | 2 = 1): DemoBundle {
  const t = now.getTime();

  const sprint: Sprint = {
    id: "demo-sprint-12",
    name: "Sprint 12",
    state: "active",
    startAt: iso(t - 4 * DAY),
    endAt: iso(t + 6 * DAY),
    committedPoints: 34,
  };

  const issues: Issue[] = [
    {
      id: "demo-issue-142",
      key: "NOVA-142",
      title: "Auth refactor cleanup",
      status: "Done",
      statusCategory: "done",
      assigneePersonId: priya.id,
      sprintId: sprint.id,
      points: 3,
      issueType: "Story",
      lastTransitionAt: iso(t - 5 * HOUR), // past the 4h D1 grace period
      lastTouchedAt: iso(t - 5 * HOUR),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-142",
      transitions: [{ fromStatus: "In Review", toStatus: "Done", at: iso(t - 5 * HOUR), actorPersonId: priya.id }],
    },
    {
      id: "demo-issue-137",
      key: "NOVA-137",
      title: "Investigate rate-limit false positives",
      status: "In Progress",
      statusCategory: "in_progress",
      assigneePersonId: wei.id,
      sprintId: sprint.id,
      points: 5,
      issueType: "Bug",
      lastTransitionAt: iso(t - 10 * DAY), // well past the 3-business-day D2 threshold
      lastTouchedAt: iso(t - 10 * DAY),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-137",
      transitions: [{ fromStatus: "To Do", toStatus: "In Progress", at: iso(t - 10 * DAY), actorPersonId: wei.id }],
    },
    {
      id: "demo-issue-150",
      key: "NOVA-150",
      title: "Ship rate limiting",
      status: "In Progress",
      statusCategory: "in_progress",
      assigneePersonId: wei.id,
      sprintId: sprint.id,
      points: 8,
      issueType: "Story",
      lastTransitionAt: iso(t - 1 * HOUR),
      lastTouchedAt: iso(t - 1 * HOUR),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-150",
      transitions: [{ fromStatus: "To Do", toStatus: "In Progress", at: iso(t - 1 * HOUR), actorPersonId: wei.id }],
    },
    {
      id: "demo-issue-131",
      key: "NOVA-131",
      title: "Auth refactor",
      status: "Done",
      statusCategory: "done",
      assigneePersonId: priya.id,
      sprintId: sprint.id,
      points: 5,
      issueType: "Story",
      lastTransitionAt: iso(t - 20 * HOUR),
      lastTouchedAt: iso(t - 20 * HOUR),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-131",
      transitions: [{ fromStatus: "In Review", toStatus: "Done", at: iso(t - 20 * HOUR), actorPersonId: priya.id }],
    },
    {
      id: "demo-issue-144",
      key: "NOVA-144",
      title: "Add rate-limit config UI",
      status: "In Review",
      statusCategory: "in_progress",
      assigneePersonId: sam.id,
      sprintId: sprint.id,
      points: 2,
      issueType: "Story",
      lastTransitionAt: iso(t - 20 * HOUR),
      lastTouchedAt: iso(t - 20 * HOUR),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-144",
      transitions: [{ fromStatus: "In Progress", toStatus: "In Review", at: iso(t - 20 * HOUR), actorPersonId: sam.id }],
    },
    {
      id: "demo-issue-146",
      key: "NOVA-146",
      title: "Write rate-limit docs",
      status: "In Progress",
      statusCategory: "in_progress",
      assigneePersonId: sam.id,
      sprintId: sprint.id,
      points: 1,
      issueType: "Task",
      lastTransitionAt: iso(t - 18 * HOUR),
      lastTouchedAt: iso(t - 18 * HOUR),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-146",
      transitions: [{ fromStatus: "Backlog", toStatus: "In Progress", at: iso(t - 18 * HOUR), actorPersonId: sam.id }],
    },
    {
      id: "demo-issue-129",
      key: "NOVA-129",
      title: "Config cleanup",
      status: "Done",
      statusCategory: "done",
      assigneePersonId: wei.id,
      sprintId: sprint.id,
      points: 2,
      issueType: "Chore",
      lastTransitionAt: iso(t - 30 * HOUR),
      lastTouchedAt: iso(t - 30 * HOUR),
      sourceUrl: "https://acme.atlassian.net/browse/NOVA-129",
      transitions: [{ fromStatus: "In Review", toStatus: "Done", at: iso(t - 30 * HOUR), actorPersonId: wei.id }],
    },
  ];

  const pr84Merged = phase === 2;

  const pullRequests: PullRequest[] = [
    {
      id: "demo-pr-88",
      repo: DEMO_REPO,
      number: 88,
      title: "Closes NOVA-142: auth refactor cleanup",
      state: "open",
      isDraft: false,
      authorPersonId: priya.id,
      authorLogin: priya.githubLogin,
      branch: "priya/nova-142-cleanup",
      readyForReviewAt: iso(t - 6 * HOUR),
      lastReviewActivityAt: iso(t - 4 * HOUR),
      sourceUrl: "https://github.com/acme/atlas/pull/88",
      reviewers: [{ personId: priya.id, isSoloRequest: false }],
      reviewEvents: [{ personId: sam.id, kind: "approved", at: iso(t - 4 * HOUR) }],
    },
    {
      id: "demo-pr-91",
      repo: DEMO_REPO,
      number: 91,
      title: "Add rate limiting",
      body: "Ships rate limiting for the public API.",
      state: "open",
      isDraft: false,
      authorPersonId: wei.id,
      authorLogin: wei.githubLogin,
      branch: "wei/nova-150-rate-limit",
      readyForReviewAt: iso(t - 10 * DAY),
      sourceUrl: "https://github.com/acme/atlas/pull/91",
      reviewers: [
        { personId: priya.id, isSoloRequest: false },
        { personId: sam.id, isSoloRequest: false },
      ],
      reviewEvents: [],
    },
    {
      id: "demo-pr-86",
      repo: DEMO_REPO,
      number: 86,
      title: "Closes NOVA-131: auth refactor",
      state: "merged",
      isDraft: false,
      authorPersonId: priya.id,
      authorLogin: priya.githubLogin,
      branch: "priya/nova-131-auth",
      readyForReviewAt: iso(t - 22 * HOUR),
      mergedAt: iso(t - 20 * HOUR),
      lastReviewActivityAt: iso(t - 21 * HOUR),
      sourceUrl: "https://github.com/acme/atlas/pull/86",
      reviewers: [],
      reviewEvents: [{ personId: wei.id, kind: "approved", at: iso(t - 21 * HOUR) }],
    },
    {
      id: "demo-pr-89",
      repo: DEMO_REPO,
      number: 89,
      title: "Fix flaky auth test",
      state: "merged",
      isDraft: false,
      authorPersonId: sam.id,
      authorLogin: sam.githubLogin,
      branch: "sam/flaky-test-fix",
      readyForReviewAt: iso(t - 21 * HOUR),
      mergedAt: iso(t - 19 * HOUR),
      lastReviewActivityAt: iso(t - 20 * HOUR),
      sourceUrl: "https://github.com/acme/atlas/pull/89",
      reviewers: [],
      reviewEvents: [{ personId: priya.id, kind: "approved", at: iso(t - 20 * HOUR) }],
    },
    {
      id: "demo-pr-84",
      repo: DEMO_REPO,
      number: 84,
      title: "Closes NOVA-129: config cleanup",
      state: pr84Merged ? "merged" : "open",
      isDraft: false,
      authorPersonId: wei.id,
      authorLogin: wei.githubLogin,
      branch: "wei/nova-129-cleanup",
      readyForReviewAt: iso(t - 31 * HOUR),
      mergedAt: pr84Merged ? iso(t - 2 * HOUR) : undefined,
      sourceUrl: "https://github.com/acme/atlas/pull/84",
      reviewers: [],
      reviewEvents: [],
    },
  ];

  const commits: Commit[] = [
    {
      id: "demo-commit-1",
      sha: "a1b2c3d",
      repo: DEMO_REPO,
      branch: "priya/nova-142-cleanup",
      authorPersonId: priya.id,
      message: "Fixes NOVA-142: tidy up middleware order",
      committedAt: iso(t - 7 * HOUR),
      sourceUrl: "https://github.com/acme/atlas/commit/a1b2c3d",
    },
    {
      id: "demo-commit-2",
      sha: "e4f5a6b",
      repo: DEMO_REPO,
      branch: "wei/nova-150-rate-limit",
      authorPersonId: wei.id,
      message: "wip: token bucket for NOVA-150",
      committedAt: iso(t - 11 * DAY),
      sourceUrl: "https://github.com/acme/atlas/commit/e4f5a6b",
    },
  ];

  return { people: [priya, wei, sam], issues, pullRequests, commits, sprint };
}
