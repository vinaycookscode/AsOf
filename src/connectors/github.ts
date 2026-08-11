import { mapLimit, withRetry } from "./http.js";
import type { CiRun, CiStatus, Commit, PrReviewEvent, PrReviewer, Person, PullRequest, ReviewEventKind } from "./types.js";
import { stableId } from "./types.js";

export interface GithubConfig {
  token: string;
  owner: string;
  repos: string[];
  /** Bot authors excluded from D3 Silent PR (drift-rules-spec.md D3 FP traps). */
  botAuthorAllowlist?: string[];
}

interface GhUser {
  login: string;
}

interface GhPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  closed_at: string | null;
  created_at: string;
  user: GhUser | null;
  head: { ref: string; sha: string };
  html_url: string;
  requested_reviewers: GhUser[];
}

interface GhReview {
  user: GhUser | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submitted_at: string;
}

interface GhCommit {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string } | null;
    message: string;
  };
  author: GhUser | null;
  html_url: string;
}

interface GhCheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "stale" | "skipped" | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
}

const PAGE_SIZE = 100;

function mapReviewState(state: GhReview["state"]): ReviewEventKind | null {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    default:
      return null; // DISMISSED / PENDING carry no standalone finding-relevant signal
  }
}

function mapCheckStatus(run: GhCheckRun): CiStatus {
  if (run.status !== "completed") return "pending";
  switch (run.conclusion) {
    case "success":
      return "success";
    case "skipped":
    case "neutral":
      return "skipped";
    case "failure":
    case "timed_out":
    case "action_required":
      return "failure";
    default:
      return "error";
  }
}

export class GithubClient {
  constructor(private readonly config: GithubConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    return withRetry(() => fetch(url, { headers: this.headers() }), (res) => res.json() as Promise<T>);
  }

  private async paginate<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const all: T[] = [];
    let page = 1;

    for (;;) {
      const query = new URLSearchParams({ ...params, per_page: String(PAGE_SIZE), page: String(page) });
      const items = await this.getJson<T[]>(`${path}?${query}`);
      all.push(...items);
      if (items.length < PAGE_SIZE) break;
      page += 1;
    }

    return all;
  }

  async fetchPullRequests(repo: string): Promise<GhPullRequest[]> {
    return this.paginate<GhPullRequest>(`/repos/${this.config.owner}/${repo}/pulls`, { state: "all" });
  }

  async fetchReviews(repo: string, prNumber: number): Promise<GhReview[]> {
    return this.paginate<GhReview>(`/repos/${this.config.owner}/${repo}/pulls/${prNumber}/reviews`);
  }

  /** since = ISO timestamp; keeps commit pulls incremental on repeat syncs. */
  async fetchCommits(repo: string, since?: string): Promise<GhCommit[]> {
    return this.paginate<GhCommit>(`/repos/${this.config.owner}/${repo}/commits`, since ? { since } : {});
  }

  async fetchCheckRuns(repo: string, ref: string): Promise<GhCheckRun[]> {
    const res = await this.getJson<{ check_runs: GhCheckRun[] }>(
      `/repos/${this.config.owner}/${repo}/commits/${ref}/check-runs?per_page=${PAGE_SIZE}`,
    );
    return res.check_runs;
  }

  private personId(login: string): string {
    return stableId("gh-person", login);
  }

  /** Pulls PRs, their reviews, and CI check runs for one repo. No file contents or diffs are fetched (README invariant #6). */
  async fetchRepoData(repo: string): Promise<{
    pullRequests: GhPullRequest[];
    reviewsByPr: Map<number, GhReview[]>;
    checkRunsByPr: Map<number, GhCheckRun[]>;
  }> {
    const pullRequests = await this.fetchPullRequests(repo);

    const reviewsList = await mapLimit(pullRequests, 5, (pr) => this.fetchReviews(repo, pr.number));
    const reviewsByPr = new Map(pullRequests.map((pr, i) => [pr.number, reviewsList[i] ?? []]));

    const checkRunsList = await mapLimit(pullRequests, 5, (pr) => this.fetchCheckRuns(repo, pr.head.sha));
    const checkRunsByPr = new Map(pullRequests.map((pr, i) => [pr.number, checkRunsList[i] ?? []]));

    return { pullRequests, reviewsByPr, checkRunsByPr };
  }

  normalize(
    repo: string,
    pullRequests: GhPullRequest[],
    reviewsByPr: Map<number, GhReview[]>,
    checkRunsByPr: Map<number, GhCheckRun[]>,
    commits: GhCommit[],
  ): { pullRequests: PullRequest[]; commits: Commit[]; ciRuns: CiRun[]; people: Person[] } {
    const peopleById = new Map<string, Person>();
    const addPerson = (login: string): string => {
      const id = this.personId(login);
      if (!peopleById.has(id)) peopleById.set(id, { id, displayName: login, githubLogin: login });
      return id;
    };

    const normalizedPrs: PullRequest[] = [];
    const normalizedCiRuns: CiRun[] = [];

    for (const pr of pullRequests) {
      const prId = stableId("gh-pr", repo, pr.number);
      const authorPersonId = pr.user ? addPerson(pr.user.login) : undefined;

      const reviews = reviewsByPr.get(pr.number) ?? [];
      const reviewEvents: PrReviewEvent[] = reviews
        .map((r): PrReviewEvent | null => {
          const kind = mapReviewState(r.state);
          if (!kind) return null;
          return { personId: r.user ? addPerson(r.user.login) : undefined, kind, at: r.submitted_at };
        })
        .filter((e): e is PrReviewEvent => e !== null);

      const lastReviewActivityAt = reviewEvents.reduce<string | undefined>(
        (latest, e) => (!latest || e.at > latest ? e.at : latest),
        undefined,
      );

      const reviewerLogins = new Set(pr.requested_reviewers.map((r) => r.login));
      const isSolo = reviewerLogins.size === 1;
      const reviewers: PrReviewer[] = pr.requested_reviewers.map((r) => ({
        personId: addPerson(r.login),
        isSoloRequest: isSolo,
      }));

      const state: PullRequest["state"] = pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open";

      normalizedPrs.push({
        id: prId,
        repo,
        number: pr.number,
        title: pr.title,
        body: pr.body ?? undefined,
        state,
        isDraft: pr.draft,
        authorPersonId,
        authorLogin: pr.user?.login,
        // GitHub's list API has no explicit "ready for review" timestamp; approximated as
        // created_at for non-draft PRs (draft PRs are excluded from D3 by definition).
        readyForReviewAt: pr.draft ? undefined : pr.created_at,
        mergedAt: pr.merged_at ?? undefined,
        closedAt: pr.closed_at ?? undefined,
        lastReviewActivityAt,
        headSha: pr.head.sha,
        branch: pr.head.ref,
        sourceUrl: pr.html_url,
        reviewers,
        reviewEvents,
      });

      for (const run of checkRunsByPr.get(pr.number) ?? []) {
        normalizedCiRuns.push({
          id: stableId("gh-check", repo, pr.number, run.name),
          prId,
          checkName: run.name,
          status: mapCheckStatus(run),
          // GitHub's check-runs API doesn't expose branch-protection "required" status to a
          // read-only token; default true, tunable via d6.flaky_check_allowlist (drift-rules-spec D6).
          isRequired: true,
          startedAt: run.started_at ?? undefined,
          completedAt: run.completed_at ?? undefined,
          sourceUrl: run.html_url,
        });
      }
    }

    const normalizedCommits: Commit[] = commits.map((c) => ({
      id: stableId("gh-commit", repo, c.sha),
      sha: c.sha,
      repo,
      authorPersonId: c.author ? addPerson(c.author.login) : undefined,
      message: c.commit.message,
      committedAt: c.commit.author?.date ?? new Date().toISOString(),
      sourceUrl: c.html_url,
    }));

    return {
      pullRequests: normalizedPrs,
      commits: normalizedCommits,
      ciRuns: normalizedCiRuns,
      people: [...peopleById.values()],
    };
  }
}
