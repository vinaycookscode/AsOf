import { describe, expect, it } from "vitest";
import { buildPrompt, validateBriefEntities, type BriefInput } from "../../src/llm/brief.js";
import type { Finding } from "../../src/rules/types.js";

const d1Finding: Finding = {
  ruleId: "D1",
  severity: "high",
  entityRefs: [{ issueKey: "NOVA-142" }, { prNumber: 88 }],
  evidence: [{ label: "NOVA-142 moved to Done", sourceUrl: "https://x/NOVA-142" }],
  message: "NOVA-142 is marked Done, but linked PR #88 is still open.",
  dedupeKey: "D1:NOVA-142",
};

const baseInput: BriefInput = {
  teamName: "Atlas squad",
  dateLabel: "Thu 6 Aug, 8:30am",
  sprint: { dayOfSprint: 6, totalDays: 10, pointsRemaining: 21, totalPoints: 34 },
  findings: [d1Finding],
  sinceYesterday: {
    merged: [{ prNumber: 86, repo: "atlas", title: "auth refactor", issueKey: "NOVA-131" }],
    movedIssues: [{ issueKey: "NOVA-144", fromStatus: "In Progress", toStatus: "In Review" }],
    resolvedFindings: [{ ruleId: "D1", entityKey: "NOVA-129", resolutionNote: "PR #84 merged at 6:40pm" }],
  },
};

describe("buildPrompt", () => {
  it("includes every hard constraint from design-spec.md §1", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toMatch(/may not introduce any entity/i);
    expect(prompt).toMatch(/monospace chip/i);
    expect(prompt).toMatch(/neutral/i);
    expect(prompt).toMatch(/exactly ONE suggestion/i);
    expect(prompt).toMatch(/<= 200 words/i);
    expect(prompt).toMatch(/at most 5 findings/i);
  });

  it("embeds the facts as JSON, verbatim, not paraphrased", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain('"team": "Atlas squad"');
    expect(prompt).toContain('"issueKey": "NOVA-142"');
    expect(prompt).toContain('"dayOfSprint": 6');
  });

  it("truncates to the top 5 findings even if more are passed in", () => {
    const many: Finding[] = Array.from({ length: 8 }, (_, i) => ({
      ...d1Finding,
      entityRefs: [{ issueKey: `NOVA-${i}` }],
      dedupeKey: `D1:NOVA-${i}`,
    }));
    const prompt = buildPrompt({ ...baseInput, findings: many });
    const occurrences = [...prompt.matchAll(/"dedupeKey"/g)];
    expect(occurrences).toHaveLength(5);
  });
});

describe("validateBriefEntities", () => {
  it("passes when every mentioned entity is in the input", () => {
    const text = "`NOVA-142` is marked Done, but `PR #88` is still open. Merged: `PR #86` closes `NOVA-131`.";
    expect(validateBriefEntities(text, baseInput)).toEqual([]);
  });

  it("flags an issue key the model invented", () => {
    const text = "`NOVA-142` is stalled, and so is `NOVA-999` apparently.";
    expect(validateBriefEntities(text, baseInput)).toEqual(["NOVA-999"]);
  });

  it("flags a PR number the model invented", () => {
    const text = "`PR #88` is open; `PR #123` also needs review.";
    expect(validateBriefEntities(text, baseInput)).toEqual(["PR #123"]);
  });

  it("allows entities that only appear in the since-yesterday resolved list", () => {
    const text = "Resolved: `NOVA-129` — PR #84 merged.";
    // NOVA-129 is allowed (resolvedFindings); "PR #84" is NOT in the allowed set for this fixture.
    expect(validateBriefEntities(text, baseInput)).toEqual(["PR #84"]);
  });
});
