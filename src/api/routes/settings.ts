import type { FastifyInstance } from "fastify";
import type { StatusCategory } from "../../connectors/types.js";
import { getOrCreateTeam } from "../../db/repository.js";
import { getRuleSettings, getStatusCategoryMap, setStatusCategoryMap, upsertRuleSetting } from "../../db/ruleConfig.js";
import type { RuleId } from "../../rules/types.js";
import { resolveTeamName } from "../../cli/context.js";
import { DEMO_TEAM_NAME } from "../../../test/fixtures/demoTeam.js";

const VALID_RULE_IDS: RuleId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];
const VALID_STATUS_CATEGORIES: StatusCategory[] = ["done", "in_progress", "blocked", "other"];

interface RuleSettingBody {
  enabled?: boolean;
  params?: Record<string, unknown>;
  slackDelivery?: "high_only" | "all" | "none";
}

/** Settings screen's rule-config + workflow-mapping surface (B26, design-spec.md §2.4 Settings). */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/rules", async () => {
    const { teamId } = await getOrCreateTeam(resolveTeamName(DEMO_TEAM_NAME));
    return { rules: await getRuleSettings(teamId) };
  });

  app.put<{ Params: { ruleId: string }; Body: RuleSettingBody }>("/api/settings/rules/:ruleId", async (request, reply) => {
    const ruleId = request.params.ruleId.toUpperCase();
    if (!VALID_RULE_IDS.includes(ruleId as RuleId)) {
      return reply.code(400).send({ error: `ruleId must be one of ${VALID_RULE_IDS.join(", ")}` });
    }

    const { teamId } = await getOrCreateTeam(resolveTeamName(DEMO_TEAM_NAME));
    const updated = await upsertRuleSetting(teamId, ruleId as RuleId, request.body ?? {});
    return updated;
  });

  app.get("/api/settings/status-map", async () => {
    const { teamId } = await getOrCreateTeam(resolveTeamName(DEMO_TEAM_NAME));
    return { statusCategoryMap: await getStatusCategoryMap(teamId) };
  });

  app.put<{ Body: Record<string, string> }>("/api/settings/status-map", async (request, reply) => {
    const map = request.body ?? {};
    for (const category of Object.values(map)) {
      if (!VALID_STATUS_CATEGORIES.includes(category as StatusCategory)) {
        return reply.code(400).send({ error: `Category "${category}" must be one of ${VALID_STATUS_CATEGORIES.join(", ")}` });
      }
    }

    const { teamId } = await getOrCreateTeam(resolveTeamName(DEMO_TEAM_NAME));
    await setStatusCategoryMap(teamId, map as Record<string, StatusCategory>);
    return { statusCategoryMap: map };
  });
}
