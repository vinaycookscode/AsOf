import { describe, expect, it } from "vitest";
import { JiraClient } from "../../src/connectors/jira.js";

const config = {
  baseUrl: "https://acme.atlassian.net",
  email: "lena@acme.com",
  apiToken: "token",
  projectKey: "NOVA",
};

const rawIssueDone = {
  id: "10001",
  key: "NOVA-142",
  fields: {
    summary: "Refactor auth middleware",
    status: { name: "Done", statusCategory: { key: "done" } },
    assignee: { accountId: "acc-1", displayName: "Priya", emailAddress: "priya@acme.com" },
    issuetype: { name: "Story" },
    updated: "2026-08-05T16:12:00.000Z",
    customfield_10016: 5,
  },
  changelog: {
    histories: [
      {
        created: "2026-08-05T16:12:00.000Z",
        author: { accountId: "acc-1", displayName: "Priya", emailAddress: "priya@acme.com" },
        items: [{ field: "status", fromString: "In Review", toString: "Done" }],
      },
      {
        created: "2026-08-03T10:00:00.000Z",
        author: { accountId: "acc-1", displayName: "Priya" },
        items: [{ field: "assignee", fromString: null, toString: "Priya" }],
      },
    ],
  },
};

const rawIssueBlocked = {
  id: "10002",
  key: "NOVA-150",
  fields: {
    summary: "Wait on vendor API",
    status: { name: "Blocked", statusCategory: { key: "indeterminate" } },
    assignee: null,
    issuetype: { name: "Task" },
    updated: "2026-08-04T09:00:00.000Z",
  },
  changelog: { histories: [] },
};

describe("JiraClient.categorize", () => {
  it("maps Jira statusCategory.key to our StatusCategory", () => {
    const client = new JiraClient(config);
    expect(client.categorize({ name: "In Progress", statusCategory: { key: "indeterminate" } })).toBe("in_progress");
    expect(client.categorize({ name: "To Do", statusCategory: { key: "new" } })).toBe("other");
    expect(client.categorize({ name: "Done", statusCategory: { key: "done" } })).toBe("done");
  });

  it("detects a Blocked-named status even though Jira buckets it as indeterminate", () => {
    const client = new JiraClient(config);
    expect(client.categorize({ name: "Blocked", statusCategory: { key: "indeterminate" } })).toBe("blocked");
  });

  it("prefers the team's onboarding override over the heuristic", () => {
    const client = new JiraClient({ ...config, statusCategoryMap: { "Code Review": "in_progress" } });
    expect(client.categorize({ name: "Code Review", statusCategory: { key: "new" } })).toBe("in_progress");
  });
});

describe("JiraClient.normalize", () => {
  it("extracts only status-field changelog entries as transitions, sorted ascending", () => {
    const client = new JiraClient(config);
    const { issues } = client.normalize([rawIssueDone], null);

    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.key).toBe("NOVA-142");
    expect(issue.statusCategory).toBe("done");
    expect(issue.transitions).toHaveLength(1); // assignee-change history entry excluded
    expect(issue.transitions[0]).toMatchObject({ fromStatus: "In Review", toStatus: "Done" });
    expect(issue.lastTransitionAt).toBe("2026-08-05T16:12:00.000Z");
    expect(issue.sourceUrl).toBe("https://acme.atlassian.net/browse/NOVA-142");
  });

  it("handles an unassigned issue with no changelog", () => {
    const client = new JiraClient(config);
    const { issues, people } = client.normalize([rawIssueBlocked], null);
    expect(issues[0]!.assigneePersonId).toBeUndefined();
    expect(issues[0]!.statusCategory).toBe("blocked");
    expect(people).toHaveLength(0);
  });

  it("deduplicates people seen as both assignee and changelog actor", () => {
    const client = new JiraClient(config);
    const { people } = client.normalize([rawIssueDone], null);
    expect(people).toHaveLength(1);
    expect(people[0]!.jiraAccountId).toBe("acc-1");
  });

  it("computes sprint committed points from issues assigned to it", () => {
    const client = new JiraClient(config);
    const sprint = { id: 7, name: "Sprint 12", state: "active" as const, startDate: "2026-08-01", endDate: "2026-08-14" };
    const { sprint: normalizedSprint, issues } = client.normalize([rawIssueDone], sprint);
    expect(issues[0]!.sprintId).toBe(normalizedSprint!.id);
    expect(normalizedSprint!.committedPoints).toBe(5);
  });
});
