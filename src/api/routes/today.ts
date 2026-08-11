import type { FastifyInstance } from "fastify";
import { getOrCreateTeam, loadTeamState } from "../../db/repository.js";
import { getRankedOpenFindings, getSinceYesterday } from "../../db/findings.js";
import { pool } from "../../db/pool.js";
import { computeSprintClock } from "../../rules/sprintClock.js";
import { resolveNow, resolveTeamName } from "../../cli/context.js";
import { DEMO_TEAM_NAME } from "../../../test/fixtures/demoTeam.js";

interface LatestBriefRow {
  content: string;
  date: string;
}

/** GET /api/today — Today screen (design-spec.md §2.4): sprint clock, ranked findings, since-yesterday, latest brief. */
export async function todayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/today", async () => {
    const teamName = resolveTeamName(DEMO_TEAM_NAME);
    const { teamId } = await getOrCreateTeam(teamName);
    const now = resolveNow();

    const [state, findings, sinceYesterday, latestBriefRes] = await Promise.all([
      loadTeamState(teamId),
      getRankedOpenFindings(teamId),
      getSinceYesterday(teamId, now),
      pool.query<LatestBriefRow>(`SELECT content, date::text as date FROM brief WHERE team_id = $1 ORDER BY date DESC LIMIT 1`, [
        teamId,
      ]),
    ]);

    const sprint = state.sprint ? computeSprintClock(state.sprint, state.issues, now) : null;

    return {
      teamName,
      now: now.toISOString(),
      sprint,
      findings,
      sinceYesterday,
      latestBrief: latestBriefRes.rows[0] ?? null,
    };
  });
}
