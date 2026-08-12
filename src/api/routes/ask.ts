import type { FastifyInstance } from "fastify";
import { env, isOllamaConfigured } from "../../config/env.js";
import { askQuestion, type AskProvider } from "../../llm/ask.js";
import { getOrCreateTeam } from "../../db/repository.js";
import { resolveNow, resolveTeamName } from "../../cli/context.js";
import { DEMO_TEAM_NAME } from "../../../test/fixtures/demoTeam.js";

interface AskBody {
  question?: string;
}

function resolveProvider(): AskProvider | null {
  if (env.anthropic.apiKey) return { kind: "anthropic", apiKey: env.anthropic.apiKey, model: env.anthropic.model };
  if (isOllamaConfigured() && env.ollama.model) return { kind: "ollama", baseUrl: env.ollama.baseUrl, model: env.ollama.model };
  return null;
}

/** POST /api/ask — chat Q&A (FR-4, B28): free-form questions answered via tool-use over the query service. */
export async function askRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AskBody }>("/api/ask", async (request, reply) => {
    const question = request.body?.question?.trim();
    if (!question) {
      reply.code(400);
      return { error: "Missing 'question' in request body" };
    }

    const provider = resolveProvider();
    if (!provider) {
      reply.code(503);
      return { error: "No LLM configured (set ANTHROPIC_API_KEY or OLLAMA_MODEL)" };
    }

    const teamName = resolveTeamName(DEMO_TEAM_NAME);
    const { teamId } = await getOrCreateTeam(teamName);
    const now = resolveNow();

    try {
      const result = await askQuestion(question, teamId, now, provider);
      return { answer: result.answer, toolCallsUsed: result.toolCallsUsed, sources: result.sources };
    } catch (err) {
      request.log.error(err);
      reply.code(502);
      return { error: (err as Error).message };
    }
  });
}
