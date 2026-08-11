import { withRetry } from "../connectors/http.js";
import { buildPrompt, validateBriefEntities, type BriefInput } from "./brief.js";

interface OllamaChatResponse {
  message: { role: string; content: string };
}

/**
 * Dev/demo-only alternative to narrateBrief() (brief.ts) — same prompt contract, same
 * entity-hallucination guard, different generator. Not the production LLM layer
 * (product-plan.md §6 specifies Claude); this exists so brief narration is runnable for free
 * without an Anthropic key.
 */
export async function narrateBriefLocal(input: BriefInput, config: { baseUrl: string; model: string }): Promise<string> {
  const prompt = buildPrompt(input);

  const response = await withRetry(
    () =>
      fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      }),
    (res) => res.json() as Promise<OllamaChatResponse>,
    { maxRetries: 2, baseDelayMs: 1000 },
  );

  const text = response.message.content.trim();

  const violations = validateBriefEntities(text, input);
  if (violations.length > 0) {
    throw new Error(
      `Local brief narrator (Ollama) introduced entities absent from the input (README invariant #2): ${violations.join(", ")}`,
    );
  }

  return text;
}
