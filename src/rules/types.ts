import type { TeamState } from "../connectors/types.js";

export type Severity = "high" | "medium" | "low";
export type RuleId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8";
export type FindingStatus = "open" | "corrected" | "ignored" | "snoozed";

export interface Evidence {
  label: string;
  sourceUrl: string;
}

export interface EntityRef {
  issueKey?: string;
  prNumber?: number;
  /** Disambiguates prNumber across connected repos when more than one is synced. */
  repo?: string;
  commitSha?: string;
  personId?: string;
}

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  entityRefs: EntityRef[];
  evidence: Evidence[]; // >= 1, enforced by the DB CHECK and by rule tests
  message: string;
  dedupeKey: string; // rule_id + primary entity — one open finding per key
}

export interface RuleConfig {
  /** "now" for the rule to reason relative to; injected, never read from Date.now() (keeps rules pure/testable). */
  now: Date;
  d1: { graceHours: number; suppressIssueTypes: string[] };
  d2: { days: number };
  d3: { days: number; botAuthorAllowlist: string[] };
  d4: { days: number };
  d5: { maxOpenReviews: number };
  d6: { flakyCheckAllowlist: string[] };
  d7: { thresholdPct: number };
  d8: { days: number };
}

export const DEFAULT_RULE_CONFIG: Omit<RuleConfig, "now"> = {
  d1: { graceHours: 4, suppressIssueTypes: [] },
  d2: { days: 3 },
  d3: { days: 2, botAuthorAllowlist: ["dependabot[bot]", "renovate[bot]"] },
  d4: { days: 2 },
  d5: { maxOpenReviews: 4 },
  d6: { flakyCheckAllowlist: [] },
  d7: { thresholdPct: 20 },
  d8: { days: 4 },
};

/** Delivery & Ranking (drift-rules-spec.md): severity, then rule priority, then age. */
export const RULE_PRIORITY: RuleId[] = ["D1", "D6", "D2", "D3", "D5", "D4", "D7", "D8"];
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function rankFindings<T extends Finding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;

    const byPriority = RULE_PRIORITY.indexOf(a.ruleId) - RULE_PRIORITY.indexOf(b.ruleId);
    if (byPriority !== 0) return byPriority;

    // "age" (spec's third tiebreaker) needs detected_at, which only exists once a finding is
    // persisted (B25, P4). Pure rule output has no such field, so we fall back to a stable order.
    return a.dedupeKey.localeCompare(b.dedupeKey);
  });
}

/** README design invariant #1: rules are pure functions, no I/O, no LLM calls. */
export type Rule = (state: TeamState, config: RuleConfig) => Finding[];

/** "Sprint day X of Y" context — computed alongside rule output, consumed by the brief narrator (design-spec.md §1). */
export interface SprintClock {
  dayOfSprint: number;
  totalDays: number;
  pointsRemaining: number;
  totalPoints: number;
}
