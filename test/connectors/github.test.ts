import { describe, expect, it } from "vitest";
import { GithubClient } from "../../src/connectors/github.js";

const config = { token: "gh-token", owner: "acme", repos: ["atlas"] };

const openPr = {
  number: 91,
  title: "Add rate limiting",
  body: null,
  state: "open" as const,
  draft: false,
  merged_at: null,
  closed_at: null,
  created_at: "2026-08-03T09:00:00.000Z",
  user: { login: "priya" },
  head: { ref: "priya/rate-limit", sha: "abc123" },
  html_url: "https://github.com/acme/atlas/pull/91",
  requested_reviewers: [{ login: "sam" }, { login: "wei" }],
};

const mergedPr = {
  number: 86,
  title: "Auth refactor",
  body: null,
  state: "closed" as const,
  draft: false,
  merged_at: "2026-08-05T16:00:00.000Z",
  closed_at: "2026-08-05T16:00:00.000Z",
  created_at: "2026-08-01T09:00:00.000Z",
  user: { login: "wei" },
  head: { ref: "wei/auth-refactor", sha: "def456" },
  html_url: "https://github.com/acme/atlas/pull/86",
  requested_reviewers: [],
};

describe("GithubClient.normalize", () => {
  it("maps merged_at presence to state=merged, not closed", () => {
    const client = new GithubClient(config);
    const { pullRequests } = client.normalize("atlas", [mergedPr], new Map(), new Map(), []);
    expect(pullRequests[0]!.state).toBe("merged");
  });

  it("does not mark reviewers as solo when multiple are requested (D5 weighting)", () => {
    const client = new GithubClient(config);
    const { pullRequests } = client.normalize("atlas", [openPr], new Map(), new Map(), []);
    expect(pullRequests[0]!.reviewers).toHaveLength(2);
    expect(pullRequests[0]!.reviewers.every((r) => r.isSoloRequest === false)).toBe(true);
  });

  it("flags a single requested reviewer as solo", () => {
    const client = new GithubClient(config);
    const soloPr = { ...openPr, requested_reviewers: [{ login: "sam" }] };
    const { pullRequests } = client.normalize("atlas", [soloPr], new Map(), new Map(), []);
    expect(pullRequests[0]!.reviewers[0]).toMatchObject({ isSoloRequest: true });
  });

  it("derives lastReviewActivityAt as the max of mapped review events, dropping DISMISSED/PENDING", () => {
    const client = new GithubClient(config);
    const reviews = new Map([
      [
        91,
        [
          { user: { login: "sam" }, state: "COMMENTED" as const, submitted_at: "2026-08-04T10:00:00.000Z" },
          { user: { login: "wei" }, state: "APPROVED" as const, submitted_at: "2026-08-05T11:00:00.000Z" },
          { user: { login: "wei" }, state: "DISMISSED" as const, submitted_at: "2026-08-06T12:00:00.000Z" },
        ],
      ],
    ]);
    const { pullRequests } = client.normalize("atlas", [openPr], reviews, new Map(), []);
    expect(pullRequests[0]!.lastReviewActivityAt).toBe("2026-08-05T11:00:00.000Z");
    expect(pullRequests[0]!.reviewEvents).toHaveLength(2);
  });

  it("maps check-run conclusions to CiStatus, defaulting pending checks correctly", () => {
    const client = new GithubClient(config);
    const checkRuns = new Map([
      [
        91,
        [
          { name: "ci/test", status: "completed" as const, conclusion: "failure" as const, started_at: null, completed_at: "2026-08-05T12:00:00.000Z", html_url: "https://x/1" },
          { name: "ci/lint", status: "in_progress" as const, conclusion: null, started_at: "2026-08-05T12:00:00.000Z", completed_at: null, html_url: "https://x/2" },
        ],
      ],
    ]);
    const { ciRuns } = client.normalize("atlas", [openPr], new Map(), checkRuns, []);
    expect(ciRuns).toHaveLength(2);
    expect(ciRuns.find((r) => r.checkName === "ci/test")!.status).toBe("failure");
    expect(ciRuns.find((r) => r.checkName === "ci/lint")!.status).toBe("pending");
  });

  it("deduplicates people across author, reviewer, and review-event roles", () => {
    const client = new GithubClient(config);
    const reviews = new Map([[91, [{ user: { login: "wei" }, state: "APPROVED" as const, submitted_at: "2026-08-05T11:00:00.000Z" }]]]);
    const soloPr = { ...openPr, requested_reviewers: [{ login: "wei" }] };
    const { people } = client.normalize("atlas", [soloPr], reviews, new Map(), []);
    const weiEntries = people.filter((p) => p.githubLogin === "wei");
    expect(weiEntries).toHaveLength(1);
  });
});
