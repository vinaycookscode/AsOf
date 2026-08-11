import { pool } from "./pool.js";
import { getRankedOpenFindings } from "./findings.js";
import type { Severity } from "../rules/types.js";

export interface PersonStateItem {
  type: "pr" | "issue";
  label: string;
  sourceUrl: string;
}

export interface PersonFlag {
  ruleId: string;
  severity: Severity;
  message: string;
}

export interface PersonState {
  personId: string;
  displayName: string;
  shipped: PersonStateItem[];
  inFlight: PersonStateItem[];
  flags: PersonFlag[];
}

/**
 * Standup screen data (design-spec.md §2.4): Shipped / In flight / Flags per person.
 * Computed on every call from issue/pull_request/finding rows — no per-person aggregate is
 * ever stored (README invariant #5, design-spec.md §3.2 "no per-person metrics table, deliberately").
 */
export async function getPersonStates(teamId: string, now: Date): Promise<PersonState[]> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [peopleRes, mergedPrsRes, closedIssuesRes, inFlightIssuesRes, openPrsRes, allIssuesRes, allPrsRes, findings] =
    await Promise.all([
      pool.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM person WHERE team_id = $1`, [teamId]),
      pool.query(
        `SELECT number, repo, title, author_person_id, source_url FROM pull_request WHERE team_id = $1 AND merged_at BETWEEN $2 AND $3`,
        [teamId, cutoff, now],
      ),
      pool.query(
        `SELECT key, title, assignee_person_id, source_url FROM issue WHERE team_id = $1 AND status_category = 'done' AND last_transition_at BETWEEN $2 AND $3`,
        [teamId, cutoff, now],
      ),
      pool.query(
        `SELECT key, title, status, assignee_person_id, source_url FROM issue WHERE team_id = $1 AND status_category = 'in_progress'`,
        [teamId],
      ),
      pool.query(
        `SELECT number, repo, title, author_person_id, source_url FROM pull_request WHERE team_id = $1 AND state = 'open'`,
        [teamId],
      ),
      pool.query<{ key: string; assignee_person_id: string | null }>(`SELECT key, assignee_person_id FROM issue WHERE team_id = $1`, [
        teamId,
      ]),
      pool.query<{ number: number; repo: string; author_person_id: string | null }>(
        `SELECT number, repo, author_person_id FROM pull_request WHERE team_id = $1`,
        [teamId],
      ),
      getRankedOpenFindings(teamId),
    ]);

  const states = new Map<string, PersonState>();
  for (const p of peopleRes.rows) {
    states.set(p.id, { personId: p.id, displayName: p.display_name, shipped: [], inFlight: [], flags: [] });
  }
  const forPerson = (personId: string | null): PersonState | undefined => (personId ? states.get(personId) : undefined);

  for (const r of mergedPrsRes.rows) {
    forPerson(r.author_person_id)?.shipped.push({ type: "pr", label: `PR #${r.number}: ${r.title}`, sourceUrl: r.source_url });
  }
  for (const r of closedIssuesRes.rows) {
    forPerson(r.assignee_person_id)?.shipped.push({ type: "issue", label: `${r.key}: ${r.title}`, sourceUrl: r.source_url });
  }
  for (const r of inFlightIssuesRes.rows) {
    forPerson(r.assignee_person_id)?.inFlight.push({
      type: "issue",
      label: `${r.key}: ${r.title} (${r.status})`,
      sourceUrl: r.source_url,
    });
  }
  for (const r of openPrsRes.rows) {
    forPerson(r.author_person_id)?.inFlight.push({ type: "pr", label: `PR #${r.number}: ${r.title}`, sourceUrl: r.source_url });
  }

  const issueAssignee = new Map(allIssuesRes.rows.map((r) => [r.key, r.assignee_person_id]));
  const prAuthorByRepoNumber = new Map(allPrsRes.rows.map((r) => [`${r.repo}#${r.number}`, r.author_person_id]));
  const prAuthorByNumber = new Map(allPrsRes.rows.map((r) => [r.number, r.author_person_id])); // fallback when a finding predates the repo-qualified EntityRef

  for (const f of findings) {
    const attributedTo = new Set<string>();
    for (const ref of f.entityRefs) {
      let personId: string | null | undefined;
      if (ref.issueKey) {
        personId = issueAssignee.get(ref.issueKey);
      } else if (ref.prNumber !== undefined) {
        personId = ref.repo ? prAuthorByRepoNumber.get(`${ref.repo}#${ref.prNumber}`) : prAuthorByNumber.get(ref.prNumber);
      }
      if (personId && !attributedTo.has(personId)) {
        attributedTo.add(personId);
        forPerson(personId)?.flags.push({ ruleId: f.ruleId, severity: f.severity, message: f.message });
      }
    }
  }

  return [...states.values()];
}
