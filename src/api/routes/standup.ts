import type { FastifyInstance } from "fastify";
import { getOrCreateTeam } from "../../db/repository.js";
import { getPersonStates } from "../../db/personState.js";
import { resolveNow, resolveTeamName } from "../../cli/context.js";
import { DEMO_TEAM_NAME } from "../../../test/fixtures/demoTeam.js";

/** GET /api/standup — Standup screen (design-spec.md §2.4): per-person Shipped / In flight / Flags. */
export async function standupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/standup", async () => {
    const teamName = resolveTeamName(DEMO_TEAM_NAME);
    const { teamId } = await getOrCreateTeam(teamName);
    const now = resolveNow();

    const people = await getPersonStates(teamId, now);

    return { teamName, now: now.toISOString(), people };
  });
}
