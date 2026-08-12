import type { StatusCategory } from "../connectors/types.js";
import { DEFAULT_RULE_CONFIG, type RuleConfig, type RuleId } from "../rules/types.js";
import { pool } from "./pool.js";

const ALL_RULE_IDS: RuleId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];
export type SlackDelivery = "high_only" | "all" | "none";

export interface RuleSetting {
  ruleId: RuleId;
  enabled: boolean;
  params: Record<string, unknown>;
  slackDelivery: SlackDelivery;
}

interface RuleConfigRow {
  rule_id: RuleId;
  enabled: boolean;
  params: Record<string, unknown>;
  slack_delivery: SlackDelivery;
}

/** Merges a team's persisted rule_config rows onto the drift-rules-spec.md §Config Surface
 *  defaults — a team with no row yet for a rule gets that rule's spec default, not an error. */
export async function getRuleSettings(teamId: string): Promise<RuleSetting[]> {
  const res = await pool.query<RuleConfigRow>(
    `SELECT rule_id, enabled, params, slack_delivery FROM rule_config WHERE team_id = $1`,
    [teamId],
  );
  const byRule = new Map(res.rows.map((r) => [r.rule_id, r]));

  return ALL_RULE_IDS.map((ruleId) => {
    const row = byRule.get(ruleId);
    return {
      ruleId,
      enabled: row?.enabled ?? true,
      params: row?.params ?? {},
      slackDelivery: row?.slack_delivery ?? "high_only",
    };
  });
}

export async function upsertRuleSetting(
  teamId: string,
  ruleId: RuleId,
  patch: Partial<Pick<RuleSetting, "enabled" | "params" | "slackDelivery">>,
): Promise<RuleSetting> {
  const current = (await getRuleSettings(teamId)).find((r) => r.ruleId === ruleId)!;
  const next: RuleSetting = {
    ruleId,
    enabled: patch.enabled ?? current.enabled,
    params: patch.params ? { ...current.params, ...patch.params } : current.params,
    slackDelivery: patch.slackDelivery ?? current.slackDelivery,
  };

  await pool.query(
    `INSERT INTO rule_config (team_id, rule_id, enabled, params, slack_delivery)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (team_id, rule_id) DO UPDATE SET
       enabled = EXCLUDED.enabled, params = EXCLUDED.params, slack_delivery = EXCLUDED.slack_delivery`,
    [teamId, ruleId, next.enabled, JSON.stringify(next.params), next.slackDelivery],
  );

  return next;
}

/** A user-supplied params blob is untyped JSON by nature; this is the one documented boundary
 *  where it's cast onto a rule's typed default shape, rather than scattering `as` elsewhere. */
function mergeParams<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  return { ...base, ...override } as T;
}

/** Builds the RuleConfig the rule engine actually consumes (rules/runner.ts) from a team's
 *  persisted settings, plus which rules are enabled — findings from a disabled rule are filtered
 *  out after running rather than skipping the (cheap, pure) computation itself. */
export async function buildRuleConfig(teamId: string, now: Date): Promise<{ config: RuleConfig; enabledRuleIds: Set<RuleId> }> {
  const settings = await getRuleSettings(teamId);
  const byRule = new Map(settings.map((s) => [s.ruleId, s]));
  const paramsFor = (ruleId: RuleId) => byRule.get(ruleId)?.params ?? {};

  const config: RuleConfig = {
    now,
    d1: mergeParams(DEFAULT_RULE_CONFIG.d1, paramsFor("D1")),
    d2: mergeParams(DEFAULT_RULE_CONFIG.d2, paramsFor("D2")),
    d3: mergeParams(DEFAULT_RULE_CONFIG.d3, paramsFor("D3")),
    d4: mergeParams(DEFAULT_RULE_CONFIG.d4, paramsFor("D4")),
    d5: mergeParams(DEFAULT_RULE_CONFIG.d5, paramsFor("D5")),
    d6: mergeParams(DEFAULT_RULE_CONFIG.d6, paramsFor("D6")),
    d7: mergeParams(DEFAULT_RULE_CONFIG.d7, paramsFor("D7")),
    d8: mergeParams(DEFAULT_RULE_CONFIG.d8, paramsFor("D8")),
  };

  return { config, enabledRuleIds: new Set(settings.filter((s) => s.enabled).map((s) => s.ruleId)) };
}

/** The workflow-mapping step (design-spec.md §2.1: drag statuses into Done-ish/In-Progress-ish/
 *  Blocked-ish buckets at onboarding) — persisted per team, read by JiraClient at sync time. */
export async function getStatusCategoryMap(teamId: string): Promise<Record<string, StatusCategory>> {
  const res = await pool.query<{ status_category_map: Record<string, StatusCategory> }>(
    `SELECT status_category_map FROM team WHERE id = $1`,
    [teamId],
  );
  return res.rows[0]?.status_category_map ?? {};
}

export async function setStatusCategoryMap(teamId: string, map: Record<string, StatusCategory>): Promise<void> {
  await pool.query(`UPDATE team SET status_category_map = $2 WHERE id = $1`, [teamId, JSON.stringify(map)]);
}
