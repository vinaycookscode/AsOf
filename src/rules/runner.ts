import type { TeamState } from "../connectors/types.js";
import type { Finding, Rule, RuleConfig } from "./types.js";
import { rankFindings } from "./types.js";

/** Runs every rule over the same TeamState/config and returns findings ranked per drift-rules-spec.md
 *  Delivery & Ranking. Rules never call each other or the LLM (README invariant #1). */
export function runRules(rules: Rule[], state: TeamState, config: RuleConfig): Finding[] {
  const findings = rules.flatMap((rule) => rule(state, config));
  return rankFindings(findings);
}
