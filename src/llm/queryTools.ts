import { loadTeamState } from "../db/repository.js";
import { getRankedOpenFindings, getSinceYesterday } from "../db/findings.js";
import { getPersonStates } from "../db/personState.js";
import { computeSprintClock } from "../rules/sprintClock.js";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The chat Q&A "query service" (design-spec.md §4.2): typed, evidence-bearing reads —
 * no free-form SQL, no giant context dumps. The model's only door to data. Reuses the same
 * db/ functions that already power the CLI and the Today/Standup screens.
 */
export const QUERY_TOOLS: ToolSpec[] = [
  {
    name: "get_drift_findings",
    description:
      "Get current open drift findings (places the board and the repo disagree), each with evidence links. Optionally filter by severity.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["high", "medium", "low"], description: "Only findings at this severity" },
      },
    },
  },
  {
    name: "get_person_state",
    description:
      "Get one team member's current state: what they shipped in the last 24h, what's in flight for them now, and any open drift findings attributed to their work. Use for any question about a named person.",
    inputSchema: {
      type: "object",
      properties: {
        personName: { type: "string", description: "The person's display name, e.g. 'Wei'" },
      },
      required: ["personName"],
    },
  },
  {
    name: "get_sprint_state",
    description: "Get the current sprint clock: which day of the sprint it is, and points remaining vs. committed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_changes_since",
    description: "Get what changed recently: merged PRs, moved issues, and resolved findings within a time window.",
    inputSchema: {
      type: "object",
      properties: {
        hoursAgo: { type: "number", description: "How many hours back to look. Defaults to 24." },
      },
    },
  },
];

export async function executeTool(name: string, args: Record<string, unknown>, teamId: string, now: Date): Promise<unknown> {
  switch (name) {
    case "get_drift_findings": {
      const findings = await getRankedOpenFindings(teamId);
      const severity = typeof args.severity === "string" ? args.severity : undefined;
      return severity ? findings.filter((f) => f.severity === severity) : findings;
    }
    case "get_person_state": {
      const personName = typeof args.personName === "string" ? args.personName : "";
      const states = await getPersonStates(teamId, now);
      const match =
        states.find((s) => s.displayName.toLowerCase() === personName.toLowerCase()) ??
        states.find((s) => s.displayName.toLowerCase().includes(personName.toLowerCase()));
      return (
        match ?? {
          error: `No team member found matching "${personName}". Known team members: ${states.map((s) => s.displayName).join(", ")}`,
        }
      );
    }
    case "get_sprint_state": {
      const state = await loadTeamState(teamId);
      return state.sprint ? computeSprintClock(state.sprint, state.issues, now) : { error: "No active sprint" };
    }
    case "get_changes_since": {
      const hoursAgo = typeof args.hoursAgo === "number" ? args.hoursAgo : 24;
      return getSinceYesterday(teamId, now, hoursAgo);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
