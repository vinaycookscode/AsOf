import { HttpError, mapLimit, withRetry } from "./http.js";
import type { Issue, IssueTransition, Person, Sprint, StatusCategory } from "./types.js";
import { stableId } from "./types.js";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /** Per-team override, set at onboarding (README invariant #4). Falls back to a heuristic default. */
  statusCategoryMap?: Record<string, StatusCategory>;
}

interface JiraChangelogItem {
  field: string;
  fromString: string | null;
  toString: string | null;
}

interface JiraChangelogEntry {
  created: string;
  author?: { accountId: string; displayName: string; emailAddress?: string };
  items: JiraChangelogItem[];
}

interface JiraIssueFields {
  summary: string;
  status: { name: string; statusCategory: { key: string } };
  assignee: { accountId: string; displayName: string; emailAddress?: string } | null;
  issuetype: { name: string };
  updated: string;
  // Story points field varies by Jira instance; MVP checks the common customfield_10016, falls back to null.
  customfield_10016?: number | null;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
  changelog?: { histories: JiraChangelogEntry[] };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  /** /rest/api/3/search/jql is cursor-paginated (no more startAt/total) — page until isLast or a missing token. */
  nextPageToken?: string;
  isLast?: boolean;
}

interface JiraBoard {
  id: number;
  name: string;
}

interface JiraSprint {
  id: number;
  name: string;
  state: "future" | "active" | "closed";
  startDate?: string;
  endDate?: string;
}

const PAGE_SIZE = 100;

export class JiraClient {
  private readonly config: JiraConfig;

  constructor(config: JiraConfig) {
    // Tolerate a trailing slash in JIRA_BASE_URL (e.g. "https://x.atlassian.net/") — otherwise
    // every request path doubles it up ("https://x.atlassian.net//rest/...").
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    return withRetry(() => fetch(url, { headers: this.headers() }), (res) => res.json() as Promise<T>);
  }

  /** Paginated issue pull with changelog (transitions) expanded, per README FR-2 / B3. */
  /** Uses /rest/api/3/search/jql (the pre-2026 /rest/api/3/search GET endpoint was removed —
   *  see https://developer.atlassian.com/changelog/#CHANGE-2046). Cursor-paginated: keep
   *  requesting nextPageToken until the API says isLast (or stops returning one). */
  async fetchIssues(): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let nextPageToken: string | undefined;

    for (;;) {
      const jql = encodeURIComponent(`project = ${this.config.projectKey} ORDER BY updated DESC`);
      const fields = encodeURIComponent("summary,status,assignee,issuetype,updated,customfield_10016");
      const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const path = `/rest/api/3/search/jql?jql=${jql}&maxResults=${PAGE_SIZE}&expand=changelog&fields=${fields}${tokenParam}`;
      const page = await this.getJson<JiraSearchResponse>(path);
      all.push(...page.issues);

      if (page.isLast || !page.nextPageToken || page.issues.length === 0) break;
      nextPageToken = page.nextPageToken;
    }

    return all;
  }

  async fetchActiveSprint(): Promise<JiraSprint | null> {
    const boards = await this.getJson<{ values: JiraBoard[] }>(
      `/rest/agile/1.0/board?projectKeyOrId=${this.config.projectKey}`,
    );
    if (boards.values.length === 0) return null;

    const sprints = await mapLimit(boards.values, 3, async (board) => {
      try {
        return await this.getJson<{ values: JiraSprint[] }>(`/rest/agile/1.0/board/${board.id}/sprint?state=active`);
      } catch (err) {
        // Kanban boards ("team-managed" projects default to this) 400 with "The board does not
        // support sprints" — a legitimate real-world case, not a failure. Any other status is.
        if (err instanceof HttpError && err.status === 400) return { values: [] };
        throw err;
      }
    });
    const active = sprints.flatMap((s) => s.values).find((s) => s.state === "active");
    return active ?? null;
  }

  /** issue.status.statusCategory.key ("new" | "indeterminate" | "done") is Jira's built-in bucket;
   *  we sharpen it with the team's own mapping when configured. */
  categorize(status: { name: string; statusCategory: { key: string } }): StatusCategory {
    const override = this.config.statusCategoryMap?.[status.name];
    if (override) return override;

    if (/block/i.test(status.name)) return "blocked";
    switch (status.statusCategory.key) {
      case "done":
        return "done";
      case "indeterminate":
        return "in_progress";
      default:
        return "other";
    }
  }

  private personId(accountId: string): string {
    return stableId("jira-person", accountId);
  }

  normalize(rawIssues: JiraIssue[], sprint: JiraSprint | null): { issues: Issue[]; people: Person[]; sprint: Sprint | null } {
    const peopleById = new Map<string, Person>();
    const issues: Issue[] = [];

    for (const raw of rawIssues) {
      const assignee = raw.fields.assignee;
      let assigneePersonId: string | undefined;
      if (assignee) {
        assigneePersonId = this.personId(assignee.accountId);
        peopleById.set(assigneePersonId, {
          id: assigneePersonId,
          displayName: assignee.displayName,
          email: assignee.emailAddress,
          jiraAccountId: assignee.accountId,
        });
      }

      const transitions: IssueTransition[] = [];
      for (const history of raw.changelog?.histories ?? []) {
        const statusChange = history.items.find((item) => item.field === "status");
        if (!statusChange) continue;
        const actorPersonId = history.author ? this.personId(history.author.accountId) : undefined;
        if (history.author && actorPersonId) {
          peopleById.set(actorPersonId, {
            id: actorPersonId,
            displayName: history.author.displayName,
            email: history.author.emailAddress,
            jiraAccountId: history.author.accountId,
          });
        }
        transitions.push({
          fromStatus: statusChange.fromString,
          toStatus: statusChange.toString ?? raw.fields.status.name,
          at: history.created,
          actorPersonId,
        });
      }
      transitions.sort((a, b) => a.at.localeCompare(b.at));
      const lastTransition = transitions[transitions.length - 1];

      issues.push({
        id: stableId("jira-issue", raw.id),
        key: raw.key,
        title: raw.fields.summary,
        status: raw.fields.status.name,
        statusCategory: this.categorize(raw.fields.status),
        assigneePersonId,
        sprintId: sprint ? stableId("jira-sprint", sprint.id) : undefined,
        points: raw.fields.customfield_10016 ?? undefined,
        issueType: raw.fields.issuetype.name,
        lastTransitionAt: lastTransition?.at,
        lastTouchedAt: raw.fields.updated,
        sourceUrl: `${this.config.baseUrl}/browse/${raw.key}`,
        transitions,
      });
    }

    const normalizedSprint: Sprint | null = sprint
      ? {
          id: stableId("jira-sprint", sprint.id),
          name: sprint.name,
          state: sprint.state,
          startAt: sprint.startDate,
          endAt: sprint.endDate,
          committedPoints: issues
            .filter((i) => i.sprintId === stableId("jira-sprint", sprint.id))
            .reduce((sum, i) => sum + (i.points ?? 0), 0),
        }
      : null;

    return { issues, people: [...peopleById.values()], sprint: normalizedSprint };
  }
}
