import { ALL_RULES, runRules } from "../rules/index.js";
import { pool } from "../db/pool.js";
import { getOrCreateTeam, loadTeamState } from "../db/repository.js";
import { getRankedOpenFindings, persistFindings } from "../db/findings.js";
import { buildRuleConfig } from "../db/ruleConfig.js";
import { resolveNow, resolveTeamName } from "./context.js";
import { DEMO_TEAM_NAME } from "../../test/fixtures/demoTeam.js";

async function main(): Promise<void> {
  const teamName = resolveTeamName(DEMO_TEAM_NAME);
  const { teamId } = await getOrCreateTeam(teamName);

  const state = await loadTeamState(teamId);
  const now = resolveNow();
  const { config, enabledRuleIds } = await buildRuleConfig(teamId, now);
  const ruleOutput = runRules(ALL_RULES, state, config).filter((f) => enabledRuleIds.has(f.ruleId));

  await persistFindings(teamId, ruleOutput);

  // Print what's actually open in the DB, not the raw rule output — they can now diverge:
  // a finding the rules still reproduce may be suppressed (ignored) or snoozed (B35).
  const findings = await getRankedOpenFindings(teamId);

  console.log(`AsOf drift — ${teamName} — ${now.toISOString()}`);
  console.log(`${findings.length} open finding(s) (D1-D8).\n`);

  for (const f of findings) {
    const marker = f.severity === "high" ? "●" : f.severity === "medium" ? "○" : "·";
    console.log(`${marker} [${f.ruleId}] ${f.message}`);
    for (const e of f.evidence) {
      console.log(`    - ${e.label}\n      ${e.sourceUrl}`);
    }
  }

  if (findings.length === 0) {
    console.log("Board and repo agree — no open findings.");
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
