import Anthropic from "@anthropic-ai/sdk";
import type { Finding, SprintClock } from "../rules/types.js";
import { rankFindings } from "../rules/types.js";
import { findUngroundedMentions } from "./groundingGuard.js";

export type { SprintClock } from "../rules/types.js";

const MAX_FINDINGS = 5;

export interface MergedPr {
  prNumber: number;
  repo: string;
  title: string;
  issueKey?: string;
}

export interface MovedIssue {
  issueKey: string;
  fromStatus: string;
  toStatus: string;
}

export interface ResolvedFinding {
  ruleId: string;
  entityKey: string;
  resolutionNote: string;
}

export interface BriefInput {
  teamName: string;
  /** e.g. "Thu 6 Aug, 8:30am" */
  dateLabel: string;
  sprint: SprintClock | null;
  findings: Finding[];
  sinceYesterday: {
    merged: MergedPr[];
    movedIssues: MovedIssue[];
    resolvedFindings: ResolvedFinding[];
  };
}

/** Every entity the model is allowed to mention — anything else in its output is a hallucination, not a finding. */
function collectAllowedEntities(input: BriefInput): Set<string> {
  const allowed = new Set<string>();
  for (const f of input.findings) {
    for (const ref of f.entityRefs) {
      if (ref.issueKey) allowed.add(ref.issueKey);
      if (ref.prNumber !== undefined) allowed.add(`PR #${ref.prNumber}`);
    }
  }
  for (const m of input.sinceYesterday.merged) {
    allowed.add(`PR #${m.prNumber}`);
    if (m.issueKey) allowed.add(m.issueKey);
  }
  for (const i of input.sinceYesterday.movedIssues) allowed.add(i.issueKey);
  for (const r of input.sinceYesterday.resolvedFindings) allowed.add(r.entityKey);
  return allowed;
}

/** README invariant #2: the LLM cannot create findings — it can only fail to render, never invent, an entity. */
export function validateBriefEntities(text: string, input: BriefInput): string[] {
  return findUngroundedMentions(text, collectAllowedEntities(input));
}

export function buildPrompt(input: BriefInput): string {
  const topFindings = rankFindings(input.findings).slice(0, MAX_FINDINGS);

  const factsJson = JSON.stringify(
    {
      team: input.teamName,
      date_label: input.dateLabel,
      sprint: input.sprint,
      findings: topFindings,
      since_yesterday: input.sinceYesterday,
    },
    null,
    2,
  );

  return `You write the AsOf morning brief — a 2-minute daily digest that replaces standup. Your ONLY job is narration: turn the facts below into prose. You did not detect these findings; a deterministic rule engine did. You may not invent, infer, or embellish anything not present in the JSON.

HARD CONSTRAINTS (violating any of these is a bug, not a style choice):
1. You may not introduce any entity (issue key, PR number, person) that does not appear in the input JSON below.
2. You may not infer a cause not present in a finding's evidence. Describe only what the evidence says.
3. Every entity you mention (issue key, PR number) must be rendered as a monospace chip, e.g. \`NOVA-142\` or \`PR #88\`.
4. Phrasing must be neutral — describe state disagreement, never person behavior. Banned: "X hasn't worked", "X forgot", "X is behind". Allowed: "the board and the repo disagree", "no activity recorded on".
5. Never give advice about a *person* ("check in with them"). Only about *work state*.
6. Show at most 5 findings, already ranked in the order given — do not re-rank them.
7. Severity markers: ● for high, ○ for medium, nothing (plain bullet) for low.
8. Include exactly ONE suggestion, tied to the single highest-ranked finding, phrased as a consequence chain ("If X happens, Y follows") — never as an instruction to a named person.
9. If the findings list is empty, say so plainly (e.g. "Board and repo agree this morning — nothing needs a decision") and still report the "Since yesterday" movement.
10. Body must be <= 200 words (excluding the header line and reply-affordance footer).
11. Always end with a line inviting a reply to ask anything.

STRUCTURE (match this shape):
- Header: "☀️ AsOf brief — {team} — {date_label}"
- Subhead: sprint clock, e.g. "Sprint day X of Y · Z of T points remaining · N findings need eyes"
- Section "Needs a decision today": one line per finding, severity marker + bolded claim + one supporting sentence + entity chips
- Section "Since yesterday": merged PRs, moved issues, and resolved findings (resolved findings get equal billing with new flags, phrased as "✓ Resolved: ...")
- Section "One suggestion": exactly one paragraph
- Footer: reply-affordance line

FACTS (the only source of truth — do not use outside knowledge):
${factsJson}

Write the brief now. Output only the brief text, no preamble.`;
}

export async function narrateBrief(input: BriefInput, apiConfig: { apiKey: string; model: string }): Promise<string> {
  const client = new Anthropic({ apiKey: apiConfig.apiKey });
  const prompt = buildPrompt(input);

  const response = await client.messages.create({
    model: apiConfig.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const violations = validateBriefEntities(text, input);
  if (violations.length > 0) {
    throw new Error(
      `Brief narrator introduced entities absent from the input (README invariant #2): ${violations.join(", ")}`,
    );
  }

  return text;
}
