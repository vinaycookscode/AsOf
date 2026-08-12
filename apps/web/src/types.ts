export type Severity = "high" | "medium" | "low";

export interface EntityRef {
  issueKey?: string;
  prNumber?: number;
  repo?: string;
  commitSha?: string;
  personId?: string;
}

export interface Evidence {
  label: string;
  sourceUrl: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  dedupeKey: string;
  message: string;
  entityRefs: EntityRef[];
  evidence: Evidence[];
}

export type FeedbackAction = "correct" | "ignore" | "snooze";

export interface SprintClock {
  dayOfSprint: number;
  totalDays: number;
  pointsRemaining: number;
  totalPoints: number;
}

export interface SinceYesterday {
  merged: { prNumber: number; repo: string; title: string }[];
  movedIssues: { issueKey: string; fromStatus: string; toStatus: string }[];
  resolvedFindings: { ruleId: string; entityKey: string; resolutionNote: string }[];
}

export interface LatestBrief {
  content: string;
  date: string;
}

export interface TodayResponse {
  teamName: string;
  now: string;
  sprint: SprintClock | null;
  findings: Finding[];
  sinceYesterday: SinceYesterday;
  latestBrief: LatestBrief | null;
}

export interface PersonStateItem {
  type: "pr" | "issue";
  label: string;
  sourceUrl: string;
}

export interface PersonFlag {
  ruleId: string;
  severity: Severity;
  message: string;
}

export interface PersonState {
  personId: string;
  displayName: string;
  shipped: PersonStateItem[];
  inFlight: PersonStateItem[];
  flags: PersonFlag[];
}

export interface StandupResponse {
  teamName: string;
  now: string;
  people: PersonState[];
}

export interface AskResponse {
  answer: string;
  toolCallsUsed: string[];
  /** entity mention (e.g. "NOVA-142", "PR #91") -> evidence source URL, for inline chips. */
  sources: Record<string, string>;
  error?: string;
}
