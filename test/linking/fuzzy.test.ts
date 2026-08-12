import { describe, expect, it, vi } from "vitest";
import type { Issue, Link, PullRequest } from "../../src/connectors/types.js";
import { extractFuzzyLinks, parseFuzzyMatchResponse, type FuzzyLinkerClient } from "../../src/linking/fuzzy.js";

function issue(overrides: Partial<Issue> & { id: string; key: string }): Issue {
  return {
    title: "t",
    status: "In Progress",
    statusCategory: "in_progress",
    sourceUrl: `https://acme.atlassian.net/browse/${overrides.key}`,
    transitions: [],
    ...overrides,
  };
}

function pr(overrides: Partial<PullRequest> & { id: string; number: number }): PullRequest {
  return {
    repo: "atlas",
    title: "t",
    state: "open",
    isDraft: false,
    sourceUrl: `https://github.com/acme/atlas/pull/${overrides.number}`,
    reviewers: [],
    reviewEvents: [],
    ...overrides,
  };
}

function stubLinker(result: { key: string; confidence: number } | null): FuzzyLinkerClient {
  return { match: vi.fn().mockResolvedValue(result) };
}

describe("extractFuzzyLinks", () => {
  it("true positive: model returns a confident match against an offered candidate", async () => {
    const issues = [issue({ id: "i1", key: "NOVA-201", title: "Rate limit config" })];
    const prs = [pr({ id: "pr1", number: 12, title: "Add rate limiting to the API gateway" })];
    const linker = stubLinker({ key: "NOVA-201", confidence: 0.7 });

    const links = await extractFuzzyLinks(prs, issues, [], linker);
    expect(links).toEqual([{ issueId: "i1", prId: "pr1", linkSource: "fuzzy", confidence: 0.7 }]);
  });

  it("boundary: confidence just below the 0.5 minimum is discarded", async () => {
    const issues = [issue({ id: "i1", key: "NOVA-201" })];
    const prs = [pr({ id: "pr1", number: 12 })];
    const linker = stubLinker({ key: "NOVA-201", confidence: 0.49 });

    expect(await extractFuzzyLinks(prs, issues, [], linker)).toEqual([]);
  });

  it("exactly 0.5 is kept (the FP-trap case sits below this, not at it)", async () => {
    const issues = [issue({ id: "i1", key: "NOVA-201" })];
    const prs = [pr({ id: "pr1", number: 12 })];
    const linker = stubLinker({ key: "NOVA-201", confidence: 0.5 });

    expect(await extractFuzzyLinks(prs, issues, [], linker)).toHaveLength(1);
  });

  it("FP trap: a PR already linked by a rule-based source is never sent to the linker at all", async () => {
    const issues = [issue({ id: "i1", key: "NOVA-201" })];
    const prs = [pr({ id: "pr1", number: 12 })];
    const existingLinks: Link[] = [{ issueId: "i1", prId: "pr1", linkSource: "branch_name", confidence: 0.9 }];
    const linker = stubLinker({ key: "NOVA-201", confidence: 0.9 });

    const links = await extractFuzzyLinks(prs, issues, existingLinks, linker);
    expect(links).toEqual([]);
    expect(linker.match).not.toHaveBeenCalled();
  });

  it("resolution: a model response naming a key outside the offered candidates is discarded, not linked", async () => {
    const issues = [issue({ id: "i1", key: "NOVA-201" })];
    const prs = [pr({ id: "pr1", number: 12 })];
    // Simulates a hallucinated/stale key slipping past a naive parse.
    const linker = stubLinker({ key: "NOVA-999", confidence: 0.9 });

    expect(await extractFuzzyLinks(prs, issues, [], linker)).toEqual([]);
  });
});

describe("parseFuzzyMatchResponse", () => {
  const candidates = [{ key: "NOVA-201", title: "Rate limit config" }];

  it("parses a well-formed match", () => {
    expect(parseFuzzyMatchResponse('{"key": "NOVA-201", "confidence": 0.8}', candidates)).toEqual({
      key: "NOVA-201",
      confidence: 0.8,
    });
  });

  it("rejects a key not in the candidate list (the model can't invent one)", () => {
    expect(parseFuzzyMatchResponse('{"key": "NOVA-999", "confidence": 0.8}', candidates)).toBeNull();
  });

  it("returns null for unparseable text instead of throwing", () => {
    expect(parseFuzzyMatchResponse("not json", candidates)).toBeNull();
  });

  it("returns null when the model explicitly says no match", () => {
    expect(parseFuzzyMatchResponse('{"key": null, "confidence": 0}', candidates)).toBeNull();
  });
});
