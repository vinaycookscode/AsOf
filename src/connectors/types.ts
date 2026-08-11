// Normalized shapes shared by connectors, linking, and rules.
// Rules read `statusCategory`, never raw status strings (README invariant #4).

export type StatusCategory = "done" | "in_progress" | "blocked" | "other";

export interface Person {
  id: string; // stable synthetic id, see personId()
  displayName: string;
  email?: string;
  jiraAccountId?: string;
  githubLogin?: string;
}

export interface IssueTransition {
  fromStatus: string | null;
  toStatus: string;
  at: string; // ISO timestamp
  actorPersonId?: string;
}

export interface Issue {
  id: string;
  key: string;
  title: string;
  status: string; // raw, display only
  statusCategory: StatusCategory;
  assigneePersonId?: string;
  sprintId?: string;
  /** When the issue entered its current sprint — needed for D7 Scope creep. Not yet populated by
   *  the B3 Jira connector (requires parsing "Sprint" field changelog entries, not just the
   *  current-state sprint report); fixtures set it directly until that connector work lands. */
  addedToSprintAt?: string;
  points?: number;
  issueType?: string;
  lastTransitionAt?: string;
  lastTouchedAt?: string;
  sourceUrl: string;
  transitions: IssueTransition[];
}

export type PullRequestState = "open" | "closed" | "merged";

export interface PrReviewer {
  personId: string;
  isSoloRequest: boolean;
}

export type ReviewEventKind = "approved" | "changes_requested" | "commented";

export interface PrReviewEvent {
  personId?: string;
  kind: ReviewEventKind;
  at: string;
}

export interface PullRequest {
  id: string;
  repo: string;
  number: number;
  title: string;
  body?: string;
  state: PullRequestState;
  isDraft: boolean;
  authorPersonId?: string;
  authorLogin?: string;
  readyForReviewAt?: string;
  mergedAt?: string;
  closedAt?: string;
  lastReviewActivityAt?: string;
  headSha?: string;
  branch?: string;
  sourceUrl: string;
  reviewers: PrReviewer[];
  reviewEvents: PrReviewEvent[];
}

export interface Commit {
  id: string;
  sha: string;
  repo: string;
  branch?: string;
  authorPersonId?: string;
  message: string;
  committedAt: string;
  sourceUrl: string;
}

export type CiStatus = "success" | "failure" | "pending" | "error" | "skipped";

export interface CiRun {
  id: string;
  prId: string;
  checkName: string;
  status: CiStatus;
  isRequired: boolean;
  startedAt?: string;
  completedAt?: string;
  sourceUrl: string;
}

export type SprintState = "future" | "active" | "closed";

export interface Sprint {
  id: string;
  name: string;
  state: SprintState;
  startAt?: string;
  endAt?: string;
  committedPoints: number;
}

export type LinkSource = "explicit" | "branch_name" | "commit_ref" | "fuzzy";

export interface Link {
  issueId: string;
  prId: string;
  linkSource: LinkSource;
  confidence: number;
}

/** Everything the rule engine reads. Assembled from Postgres per drift-rules-spec.md §0. */
export interface TeamState {
  issues: Issue[];
  pullRequests: PullRequest[];
  commits: Commit[];
  ciRuns: CiRun[];
  people: Person[];
  sprint: Sprint | null;
  links: Link[];
}

/** Deterministic synthetic id so normalization is stable across syncs without a DB round-trip. */
export function stableId(...parts: (string | number)[]): string {
  return parts.map(String).join(":");
}
