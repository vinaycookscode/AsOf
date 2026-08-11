import type { EntityRef, Finding } from "../rules/types.js";
import { rankFindings } from "../rules/types.js";
import { pool, withTransaction } from "./pool.js";

/** Days a snoozed finding stays hidden before it's eligible to reopen (B35). */
const SNOOZE_DAYS = 3;

/**
 * Upserts fresh findings as open, and auto-resolves any previously-open finding the rules no
 * longer produce. B35 additions: findings under an active suppression (from 'ignore' feedback)
 * never reopen; findings still within their snooze window are skipped; a finding whose snooze
 * has expired reopens in place (same row, same detected_at) rather than duplicating.
 */
export async function persistFindings(teamId: string, findings: Finding[]): Promise<void> {
  await withTransaction(async (client) => {
    const freshByKey = new Map(findings.map((f) => [f.dedupeKey, f]));

    const suppressionRes = await client.query<{ scope: { dedupeKey?: string } }>(
      `SELECT scope FROM suppression WHERE team_id = $1`,
      [teamId],
    );
    const suppressedKeys = new Set(suppressionRes.rows.map((r) => r.scope.dedupeKey).filter((k): k is string => Boolean(k)));

    const existingRes = await client.query<{ id: string; dedupe_key: string; status: string; snoozed_until: Date | null }>(
      `SELECT id, dedupe_key, status, snoozed_until FROM finding WHERE team_id = $1 AND status IN ('open','snoozed','ignored')`,
      [teamId],
    );
    const existingByKey = new Map(existingRes.rows.map((r) => [r.dedupe_key, r]));

    for (const f of findings) {
      if (suppressedKeys.has(f.dedupeKey)) continue; // permanently ignored via feedback

      const existing = existingByKey.get(f.dedupeKey);
      if (existing?.status === "ignored") continue; // belt-and-suspenders if a suppression row is missing

      if (existing?.status === "snoozed") {
        if (existing.snoozed_until && existing.snoozed_until > new Date()) continue; // still snoozed

        await client.query(
          `UPDATE finding SET status = 'open', snoozed_until = NULL,
             severity = $2, message = $3, entity_refs = $4, evidence = $5
           WHERE id = $1`,
          [existing.id, f.severity, f.message, JSON.stringify(f.entityRefs), JSON.stringify(f.evidence)],
        );
        continue;
      }

      await client.query(
        `INSERT INTO finding (team_id, rule_id, severity, dedupe_key, message, entity_refs, evidence, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open')
         ON CONFLICT (team_id, dedupe_key) WHERE status = 'open' DO UPDATE SET
           severity = EXCLUDED.severity, message = EXCLUDED.message, entity_refs = EXCLUDED.entity_refs, evidence = EXCLUDED.evidence`,
        [teamId, f.ruleId, f.severity, f.dedupeKey, f.message, JSON.stringify(f.entityRefs), JSON.stringify(f.evidence)],
      );
    }

    const stillOpen = await client.query<{ id: string; dedupe_key: string }>(
      `SELECT id, dedupe_key FROM finding WHERE team_id = $1 AND status = 'open'`,
      [teamId],
    );
    for (const row of stillOpen.rows) {
      if (!freshByKey.has(row.dedupe_key)) {
        await client.query(`UPDATE finding SET status = 'corrected', resolved_at = now() WHERE id = $1`, [row.id]);
      }
    }
  });
}

export type FeedbackAction = "correct" | "ignore" | "snooze";

/**
 * Records a correct/ignore/snooze action (B35, FR-7). 'ignore' resolves the finding and writes a
 * standing suppression row scoped to this exact dedupe_key, so the next drift run never reopens
 * it (broader pattern-level suppression, e.g. by issue type, is a later extension — not built
 * here). 'snooze' hides it for SNOOZE_DAYS; persistFindings reopens the same row once that
 * passes. 'correct' only logs feedback — the finding stays open until the real condition clears.
 */
export async function recordFeedback(findingId: string, action: FeedbackAction, actorPersonId?: string): Promise<{ status: string }> {
  return withTransaction(async (client) => {
    const findingRes = await client.query<{ team_id: string; rule_id: string; dedupe_key: string }>(
      `SELECT team_id, rule_id, dedupe_key FROM finding WHERE id = $1`,
      [findingId],
    );
    const finding = findingRes.rows[0];
    if (!finding) throw new Error(`finding ${findingId} not found`);

    const feedbackRes = await client.query<{ id: string }>(
      `INSERT INTO feedback (finding_id, action, actor_person_id) VALUES ($1, $2, $3) RETURNING id`,
      [findingId, action, actorPersonId ?? null],
    );

    if (action === "ignore") {
      await client.query(`UPDATE finding SET status = 'ignored', resolved_at = now() WHERE id = $1`, [findingId]);
      await client.query(
        `INSERT INTO suppression (team_id, rule_id, scope, reason, created_from_feedback_id) VALUES ($1, $2, $3, $4, $5)`,
        [
          finding.team_id,
          finding.rule_id,
          JSON.stringify({ dedupeKey: finding.dedupe_key }),
          "marked intentional via feedback",
          feedbackRes.rows[0]!.id,
        ],
      );
      return { status: "ignored" };
    }

    if (action === "snooze") {
      await client.query(`UPDATE finding SET status = 'snoozed', snoozed_until = now() + $2 * interval '1 day' WHERE id = $1`, [
        findingId,
        SNOOZE_DAYS,
      ]);
      return { status: "snoozed" };
    }

    return { status: "open" };
  });
}

interface FindingRow {
  id: string;
  rule_id: string;
  severity: string;
  dedupe_key: string;
  message: string;
  entity_refs: EntityRef[];
  evidence: { label: string; sourceUrl: string }[];
}

export interface PersistedFinding extends Finding {
  id: string;
}

function rowToFinding(row: FindingRow): PersistedFinding {
  return {
    id: row.id,
    ruleId: row.rule_id as Finding["ruleId"],
    severity: row.severity as Finding["severity"],
    dedupeKey: row.dedupe_key,
    message: row.message,
    entityRefs: row.entity_refs,
    evidence: row.evidence,
  };
}

export async function getRankedOpenFindings(teamId: string): Promise<PersistedFinding[]> {
  const res = await pool.query<FindingRow>(
    `SELECT id, rule_id, severity, dedupe_key, message, entity_refs, evidence FROM finding WHERE team_id = $1 AND status = 'open'`,
    [teamId],
  );
  return rankFindings(res.rows.map(rowToFinding));
}

export interface SinceYesterday {
  merged: { prNumber: number; repo: string; title: string }[];
  movedIssues: { issueKey: string; fromStatus: string; toStatus: string }[];
  resolvedFindings: { ruleId: string; entityKey: string; resolutionNote: string }[];
}

/** Approximation for the P3 prototype: a rolling window (default 24h), not a persisted "since last brief" cursor (that needs event_log, B17/P4). */
export async function getSinceYesterday(teamId: string, now: Date, windowHours = 24): Promise<SinceYesterday> {
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const mergedRes = await pool.query<{ number: number; repo: string; title: string }>(
    `SELECT number, repo, title FROM pull_request WHERE team_id = $1 AND merged_at >= $2 AND merged_at <= $3 ORDER BY merged_at`,
    [teamId, cutoff, now],
  );

  const movedRes = await pool.query<{ key: string; from_status: string | null; to_status: string }>(
    `SELECT DISTINCT ON (i.id) i.key, it.from_status, it.to_status
     FROM issue_transition it JOIN issue i ON i.id = it.issue_id
     WHERE i.team_id = $1 AND it.at >= $2 AND it.at <= $3
     ORDER BY i.id, it.at DESC`,
    [teamId, cutoff, now],
  );

  const resolvedRes = await pool.query<{ rule_id: string; entity_refs: EntityRef[]; message: string; resolved_at: Date }>(
    `SELECT rule_id, entity_refs, message, resolved_at FROM finding WHERE team_id = $1 AND status = 'corrected' AND resolved_at >= $2 AND resolved_at <= $3`,
    [teamId, cutoff, now],
  );

  return {
    merged: mergedRes.rows.map((r) => ({ prNumber: r.number, repo: r.repo, title: r.title })),
    movedIssues: movedRes.rows
      .filter((r) => r.from_status !== null)
      .map((r) => ({ issueKey: r.key, fromStatus: r.from_status as string, toStatus: r.to_status })),
    resolvedFindings: resolvedRes.rows.map((r) => ({
      ruleId: r.rule_id,
      entityKey: r.entity_refs[0]?.issueKey ?? (r.entity_refs[0]?.prNumber !== undefined ? `PR #${r.entity_refs[0].prNumber}` : "unknown"),
      resolutionNote: `resolved at ${r.resolved_at.toISOString()}`,
    })),
  };
}

export async function saveBrief(teamId: string, date: string, content: string, findingDedupeKeys: string[]): Promise<void> {
  await pool.query(
    `INSERT INTO brief (team_id, date, content, findings_included, delivered_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (team_id, date) DO UPDATE SET content = EXCLUDED.content, findings_included = EXCLUDED.findings_included, delivered_at = now()`,
    [teamId, date, content, JSON.stringify(findingDedupeKeys)],
  );
}
