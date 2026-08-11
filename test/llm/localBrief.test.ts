import { afterEach, describe, expect, it, vi } from "vitest";
import { narrateBriefLocal } from "../../src/llm/localBrief.js";
import type { BriefInput } from "../../src/llm/brief.js";
import type { Finding } from "../../src/rules/types.js";

const d1Finding: Finding = {
  ruleId: "D1",
  severity: "high",
  entityRefs: [{ issueKey: "NOVA-142" }, { prNumber: 88 }],
  evidence: [{ label: "NOVA-142 moved to Done", sourceUrl: "https://x/NOVA-142" }],
  message: "NOVA-142 is marked Done, but linked PR #88 is still open.",
  dedupeKey: "D1:NOVA-142",
};

const input: BriefInput = {
  teamName: "Atlas squad",
  dateLabel: "Thu 6 Aug, 8:30am",
  sprint: { dayOfSprint: 6, totalDays: 10, pointsRemaining: 21, totalPoints: 34 },
  findings: [d1Finding],
  sinceYesterday: { merged: [], movedIssues: [], resolvedFindings: [] },
};

function mockOllamaResponse(content: string) {
  return new Response(JSON.stringify({ message: { role: "assistant", content } }), { status: 200 });
}

describe("narrateBriefLocal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the built prompt to Ollama's /api/chat and returns the response content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockOllamaResponse("`NOVA-142` is marked Done, but `PR #88` is still open."));

    const text = await narrateBriefLocal(input, { baseUrl: "http://localhost:11434", model: "llama3.1:8b" });

    expect(text).toBe("`NOVA-142` is marked Done, but `PR #88` is still open.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.model).toBe("llama3.1:8b");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain("NOVA-142");
  });

  it("throws when the local model hallucinates an entity not in the input", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockOllamaResponse("`NOVA-142` is fine, but so is `NOVA-999`."));

    await expect(narrateBriefLocal(input, { baseUrl: "http://localhost:11434", model: "llama3.1:8b" })).rejects.toThrow(/NOVA-999/);
  });
});
