import Anthropic from "@anthropic-ai/sdk";
import type { Issue, Link, PullRequest } from "../connectors/types.js";

export interface FuzzyMatchCandidate {
  key: string;
  title: string;
}

export interface FuzzyMatchResult {
  key: string;
  confidence: number;
}

export interface FuzzyLinkerClient {
  match(pr: { number: number; title: string; body?: string }, candidates: FuzzyMatchCandidate[]): Promise<FuzzyMatchResult | null>;
}

/** Below this, a fuzzy guess is noise, not signal — discarded rather than linked. */
const MIN_CONFIDENCE = 0.5;

export function buildFuzzyMatchPrompt(pr: { number: number; title: string; body?: string }, candidates: FuzzyMatchCandidate[]): string {
  const list = candidates.map((c) => `${c.key}: ${c.title}`).join("\n");
  return `A GitHub PR may relate to one of these Jira issues, even though it doesn't reference an issue key explicitly anywhere. Decide if there's a plausible match based on subject-matter overlap between the PR and an issue's title.

PR #${pr.number}: ${pr.title}
${pr.body ? `Body: ${pr.body.slice(0, 500)}` : ""}

Candidate issues (only these — do not invent a key not listed):
${list}

Respond with ONLY a JSON object, no other text, no markdown fences: {"key": "<issue key or null>", "confidence": <0-1>}. Use null for key if none plausibly match. Be conservative — a wrong link costs more than a miss.`;
}

/** Defends against a hallucinated key (not in the offered candidate list) or a malformed response. */
export function parseFuzzyMatchResponse(text: string, candidates: FuzzyMatchCandidate[]): FuzzyMatchResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { key, confidence } = parsed as { key?: unknown; confidence?: unknown };
  if (typeof key !== "string" || typeof confidence !== "number") return null;
  if (!candidates.some((c) => c.key === key)) return null;
  return { key, confidence };
}

/** Real Haiku-backed matcher (product-plan.md §6: "Haiku for cheap classification/entity linking"). */
export function createHaikuLinker(apiKey: string, model = "claude-haiku-4-5"): FuzzyLinkerClient {
  const client = new Anthropic({ apiKey });
  return {
    async match(pr, candidates) {
      if (candidates.length === 0) return null;
      const response = await client.messages.create({
        model,
        max_tokens: 256,
        messages: [{ role: "user", content: buildFuzzyMatchPrompt(pr, candidates) }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return parseFuzzyMatchResponse(text, candidates);
    },
  };
}

/**
 * Last-resort linking pass (B19, product-plan.md Risk 2 / §6). Only runs on PRs no rule-based
 * source (explicit/branch_name/commit_ref) matched — avoids redundant, costly calls on the PRs
 * that already have a strong link. Always linkSource "fuzzy": drift-rules-spec.md §0 has D1/D2/D6
 * explicitly exclude fuzzy links from their linking gate, so a wrong guess here can never itself
 * drive a High-severity finding — it can only ever support Medium/Low.
 */
export async function extractFuzzyLinks(
  pullRequests: PullRequest[],
  issues: Issue[],
  existingLinks: Link[],
  linker: FuzzyLinkerClient,
): Promise<Link[]> {
  const linkedPrIds = new Set(existingLinks.map((l) => l.prId));
  const unmatched = pullRequests.filter((pr) => !linkedPrIds.has(pr.id));
  if (unmatched.length === 0) return [];

  const candidates: FuzzyMatchCandidate[] = issues.map((i) => ({ key: i.key, title: i.title }));
  const issueIdByKey = new Map(issues.map((i) => [i.key, i.id]));

  const results = await Promise.all(
    unmatched.map(async (pr): Promise<Link | null> => {
      const match = await linker.match({ number: pr.number, title: pr.title, body: pr.body }, candidates);
      if (!match || match.confidence < MIN_CONFIDENCE) return null;

      const issueId = issueIdByKey.get(match.key);
      if (!issueId) return null;

      return { issueId, prId: pr.id, linkSource: "fuzzy", confidence: match.confidence };
    }),
  );

  return results.filter((l): l is Link => l !== null);
}
