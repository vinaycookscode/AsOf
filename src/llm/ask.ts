import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "../connectors/http.js";
import { findEntityMentions, findUngroundedMentions } from "./groundingGuard.js";
import { executeTool, QUERY_TOOLS } from "./queryTools.js";

const MAX_TOOL_ITERATIONS = 4;

export interface AskResult {
  answer: string;
  toolCallsUsed: string[];
  /** entity mention (e.g. "NOVA-142", "PR #91") -> evidence source URL, for clickable chips (B33). */
  sources: Record<string, string>;
}

/**
 * Walks a tool result tree collecting entity->sourceUrl pairs, so the Ask screen can render
 * clickable source chips inline (design principle 1: evidence or it didn't happen) instead of
 * plain text. Recognizes two shapes already used across the query service: Finding-like
 * (entityRefs + evidence, matched by label substring — same pattern FindingCard.tsx uses for its
 * chips) and label+sourceUrl-like (PersonStateItem, merged PRs).
 */
function collectSources(value: unknown, sources: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectSources(v, sources);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;

  if (Array.isArray(obj.entityRefs) && Array.isArray(obj.evidence)) {
    for (const ref of obj.entityRefs as Record<string, unknown>[]) {
      const label = typeof ref.issueKey === "string" ? ref.issueKey : typeof ref.prNumber === "number" ? `PR #${ref.prNumber}` : undefined;
      if (!label) continue;
      const evidence = (obj.evidence as { label?: unknown; sourceUrl?: unknown }[]).find(
        (e) => typeof e.label === "string" && e.label.includes(label),
      );
      if (typeof evidence?.sourceUrl === "string") sources.set(label, evidence.sourceUrl);
    }
  }

  if (typeof obj.label === "string" && typeof obj.sourceUrl === "string") {
    for (const mention of findEntityMentions(obj.label)) sources.set(mention, obj.sourceUrl);
  }

  for (const v of Object.values(obj)) collectSources(v, sources);
}

function buildAskSystemPrompt(): string {
  return `You are AsOf's assistant. You answer questions about a team's sprint state using ONLY the tools provided — call them to get facts, never guess or use outside knowledge. You did not detect any findings; a deterministic rule engine did, and tools are your only way to see them.

HARD CONSTRAINTS:
1. You may not invent any issue key, PR number, or person not returned by a tool call.
2. Cite entities precisely as \`KEY\` (e.g. \`NOVA-142\`) or \`PR #N\` so they can be rendered as chips.
3. Phrasing must be neutral about people — describe work state, never behavior. Banned: "X hasn't worked", "X forgot", "X is behind". Allowed: "no activity recorded", "the board and repo disagree".
4. Never give advice about a person ("check in with them"), only about work state.
5. If a tool returns an error (e.g. person not found), say so plainly using the tool's suggestion — don't guess who they meant.
6. This answer will be read aloud via text-to-speech: write short, natural spoken sentences. No markdown, no bullet lists, no code blocks.
7. If the answer requires more than one tool, call them one at a time and use the results together.
8. Respond only in English, regardless of what language the question was asked in.`;
}

async function askQuestionClaude(
  question: string,
  teamId: string,
  now: Date,
  apiConfig: { apiKey: string; model: string },
): Promise<AskResult> {
  const client = new Anthropic({ apiKey: apiConfig.apiKey });
  const tools: Anthropic.Tool[] = QUERY_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const allowedEntities = new Set<string>();
  const toolCallsUsed: string[] = [];
  const sources = new Map<string, string>();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: apiConfig.model,
      max_tokens: 1024,
      system: buildAskSystemPrompt(),
      tools,
      messages,
    });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const violations = findUngroundedMentions(text, allowedEntities);
      if (violations.length > 0) {
        throw new Error(`Ask (Claude) introduced entities absent from tool results: ${violations.join(", ")}`);
      }
      return { answer: text, toolCallsUsed, sources: Object.fromEntries(sources) };
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolCallsUsed.push(tu.name);
      const result = await executeTool(tu.name, (tu.input as Record<string, unknown>) ?? {}, teamId, now);
      for (const m of findEntityMentions(JSON.stringify(result))) allowedEntities.add(m);
      collectSources(result, sources);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Ask (Claude) exceeded ${MAX_TOOL_ITERATIONS} tool-use iterations without a final answer`);
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatResponse {
  message: OllamaMessage;
}

async function askQuestionOllama(
  question: string,
  teamId: string,
  now: Date,
  config: { baseUrl: string; model: string },
): Promise<AskResult> {
  const tools = QUERY_TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  const messages: OllamaMessage[] = [
    { role: "system", content: buildAskSystemPrompt() },
    { role: "user", content: question },
  ];
  const allowedEntities = new Set<string>();
  const toolCallsUsed: string[] = [];
  const sources = new Map<string, string>();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await withRetry(
      () =>
        fetch(`${config.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.model, messages, tools, stream: false }),
        }),
      (res) => res.json() as Promise<OllamaChatResponse>,
      { maxRetries: 2, baseDelayMs: 1000 },
    );

    const toolCalls = response.message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = response.message.content.trim();
      const violations = findUngroundedMentions(text, allowedEntities);
      if (violations.length > 0) {
        throw new Error(`Ask (Ollama) introduced entities absent from tool results: ${violations.join(", ")}`);
      }
      return { answer: text, toolCallsUsed, sources: Object.fromEntries(sources) };
    }

    messages.push(response.message);
    for (const call of toolCalls) {
      toolCallsUsed.push(call.function.name);
      const result = await executeTool(call.function.name, call.function.arguments ?? {}, teamId, now);
      for (const m of findEntityMentions(JSON.stringify(result))) allowedEntities.add(m);
      collectSources(result, sources);
      messages.push({ role: "tool", content: JSON.stringify(result) });
    }
  }

  throw new Error(`Ask (Ollama) exceeded ${MAX_TOOL_ITERATIONS} tool-use iterations without a final answer`);
}

export type AskProvider =
  | { kind: "anthropic"; apiKey: string; model: string }
  | { kind: "ollama"; baseUrl: string; model: string };

export async function askQuestion(question: string, teamId: string, now: Date, provider: AskProvider): Promise<AskResult> {
  if (provider.kind === "anthropic") {
    return askQuestionClaude(question, teamId, now, provider);
  }
  return askQuestionOllama(question, teamId, now, provider);
}
