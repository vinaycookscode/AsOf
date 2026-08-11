import { env, isOllamaConfigured, requireAnthropicConfig, requireOllamaConfig } from "../config/env.js";
import { narrateBrief, type BriefInput } from "../llm/brief.js";
import { narrateBriefLocal } from "../llm/localBrief.js";
import { computeSprintClock } from "../rules/sprintClock.js";
import { pool } from "../db/pool.js";
import { getOrCreateTeam, loadTeamState } from "../db/repository.js";
import { getRankedOpenFindings, getSinceYesterday, saveBrief } from "../db/findings.js";
import { resolveNow, resolveTeamName } from "./context.js";
import { DEMO_TEAM_NAME } from "../../test/fixtures/demoTeam.js";

function formatDateLabel(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(now);
}

async function main(): Promise<void> {
  const teamName = resolveTeamName(DEMO_TEAM_NAME);
  const { teamId } = await getOrCreateTeam(teamName);
  const now = resolveNow();

  const state = await loadTeamState(teamId);
  const findings = await getRankedOpenFindings(teamId);
  const sinceYesterday = await getSinceYesterday(teamId, now);

  const sprintClock = state.sprint ? computeSprintClock(state.sprint, state.issues, now) : null;

  const input: BriefInput = {
    teamName,
    dateLabel: formatDateLabel(now),
    sprint: sprintClock,
    findings,
    sinceYesterday: {
      merged: sinceYesterday.merged.map((m) => ({ prNumber: m.prNumber, repo: m.repo, title: m.title })),
      movedIssues: sinceYesterday.movedIssues,
      resolvedFindings: sinceYesterday.resolvedFindings,
    },
  };

  let briefText: string;
  if (env.anthropic.apiKey) {
    briefText = await narrateBrief(input, requireAnthropicConfig());
  } else if (isOllamaConfigured()) {
    console.log(`ANTHROPIC_API_KEY not set — narrating locally via Ollama (${env.ollama.model}).\n`);
    briefText = await narrateBriefLocal(input, requireOllamaConfig());
  } else {
    console.log("ANTHROPIC_API_KEY not set and OLLAMA_MODEL not set — printing the structured facts the brief would be narrated from.\n");
    briefText = JSON.stringify(input, null, 2);
  }

  console.log(briefText);

  const dateOnly = now.toISOString().slice(0, 10);
  await saveBrief(
    teamId,
    dateOnly,
    briefText,
    findings.map((f) => f.dedupeKey),
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
