import type { PoolClient } from "pg";
import type {
  CiRun,
  Commit,
  Issue,
  Link,
  Person,
  PullRequest,
  Sprint,
  TeamState,
} from "../connectors/types.js";
import { pool, withTransaction } from "./pool.js";

export interface SyncBundle {
  people: Person[];
  issues: Issue[];
  pullRequests: PullRequest[];
  commits: Commit[];
  ciRuns: CiRun[];
  links: Link[];
  sprint: Sprint | null;
}

export async function getOrCreateTeam(teamName: string): Promise<{ tenantId: string; teamId: string }> {
  const existing = await pool.query<{ team_id: string; tenant_id: string }>(
    `SELECT t.id as team_id, te.id as tenant_id FROM team t JOIN tenant te ON te.id = t.tenant_id WHERE t.name = $1 LIMIT 1`,
    [teamName],
  );
  if (existing.rows[0]) {
    return { tenantId: existing.rows[0].tenant_id, teamId: existing.rows[0].team_id };
  }

  const tenant = await pool.query<{ id: string }>(`INSERT INTO tenant (name) VALUES ($1) RETURNING id`, [teamName]);
  const team = await pool.query<{ id: string }>(`INSERT INTO team (tenant_id, name) VALUES ($1, $2) RETURNING id`, [
    tenant.rows[0]!.id,
    teamName,
  ]);
  return { tenantId: tenant.rows[0]!.id, teamId: team.rows[0]!.id };
}

async function upsertPerson(client: PoolClient, teamId: string, person: Person): Promise<string> {
  const matchColumn = person.jiraAccountId ? "jira_account_id" : "github_login";
  const matchValue = person.jiraAccountId ?? person.githubLogin;
  if (!matchValue) throw new Error(`Person ${person.displayName} has neither jiraAccountId nor githubLogin`);

  const existing = await client.query<{ person_id: string }>(
    `SELECT person_id FROM identity_map WHERE ${matchColumn} = $1`,
    [matchValue],
  );

  if (existing.rows[0]) {
    const personId = existing.rows[0].person_id;
    await client.query(`UPDATE person SET display_name = $1, email = COALESCE($2, email) WHERE id = $3`, [
      person.displayName,
      person.email ?? null,
      personId,
    ]);
    return personId;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO person (team_id, display_name, email) VALUES ($1, $2, $3) RETURNING id`,
    [teamId, person.displayName, person.email ?? null],
  );
  const personId = inserted.rows[0]!.id;
  await client.query(
    `INSERT INTO identity_map (person_id, jira_account_id, github_login, match_confidence) VALUES ($1, $2, $3, $4)`,
    [personId, person.jiraAccountId ?? null, person.githubLogin ?? null, 1.0],
  );
  return personId;
}

async function upsertSprint(client: PoolClient, teamId: string, sprint: Sprint): Promise<string> {
  const existing = await client.query<{ id: string }>(`SELECT id FROM sprint WHERE team_id = $1 AND name = $2`, [
    teamId,
    sprint.name,
  ]);
  if (existing.rows[0]) {
    await client.query(`UPDATE sprint SET state = $1, start_at = $2, end_at = $3, committed_points = $4 WHERE id = $5`, [
      sprint.state,
      sprint.startAt ?? null,
      sprint.endAt ?? null,
      sprint.committedPoints,
      existing.rows[0].id,
    ]);
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO sprint (team_id, name, state, start_at, end_at, committed_points) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [teamId, sprint.name, sprint.state, sprint.startAt ?? null, sprint.endAt ?? null, sprint.committedPoints],
  );
  return inserted.rows[0]!.id;
}

async function upsertIssue(
  client: PoolClient,
  teamId: string,
  issue: Issue,
  assigneeDbId: string | null,
  sprintDbId: string | null,
  personIdMap: Map<string, string>,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO issue (team_id, key, title, status, status_category, assignee_person_id, sprint_id, points, issue_type, last_transition_at, last_touched_at, source_url, raw_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (team_id, key) DO UPDATE SET
       title = EXCLUDED.title, status = EXCLUDED.status, status_category = EXCLUDED.status_category,
       assignee_person_id = EXCLUDED.assignee_person_id, sprint_id = EXCLUDED.sprint_id, points = EXCLUDED.points,
       issue_type = EXCLUDED.issue_type, last_transition_at = EXCLUDED.last_transition_at,
       last_touched_at = EXCLUDED.last_touched_at, source_url = EXCLUDED.source_url, raw_updated_at = EXCLUDED.raw_updated_at
     RETURNING id`,
    [
      teamId,
      issue.key,
      issue.title,
      issue.status,
      issue.statusCategory,
      assigneeDbId,
      sprintDbId,
      issue.points ?? null,
      issue.issueType ?? null,
      issue.lastTransitionAt ?? null,
      issue.lastTouchedAt ?? null,
      issue.sourceUrl,
      issue.lastTouchedAt ?? new Date().toISOString(),
    ],
  );
  const issueDbId = result.rows[0]!.id;

  await client.query(`DELETE FROM issue_transition WHERE issue_id = $1`, [issueDbId]);
  for (const t of issue.transitions) {
    const actorDbId = t.actorPersonId ? (personIdMap.get(t.actorPersonId) ?? null) : null;
    await client.query(
      `INSERT INTO issue_transition (issue_id, from_status, to_status, at, actor_person_id) VALUES ($1,$2,$3,$4,$5)`,
      [issueDbId, t.fromStatus, t.toStatus, t.at, actorDbId],
    );
  }

  return issueDbId;
}

async function upsertPullRequest(
  client: PoolClient,
  teamId: string,
  pr: PullRequest,
  authorDbId: string | null,
  personIdMap: Map<string, string>,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO pull_request (team_id, repo, number, title, state, is_draft, author_person_id, ready_for_review_at, merged_at, closed_at, last_review_activity_at, source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (team_id, repo, number) DO UPDATE SET
       title = EXCLUDED.title, state = EXCLUDED.state, is_draft = EXCLUDED.is_draft, author_person_id = EXCLUDED.author_person_id,
       ready_for_review_at = EXCLUDED.ready_for_review_at, merged_at = EXCLUDED.merged_at, closed_at = EXCLUDED.closed_at,
       last_review_activity_at = EXCLUDED.last_review_activity_at, source_url = EXCLUDED.source_url
     RETURNING id`,
    [
      teamId,
      pr.repo,
      pr.number,
      pr.title,
      pr.state,
      pr.isDraft,
      authorDbId,
      pr.readyForReviewAt ?? null,
      pr.mergedAt ?? null,
      pr.closedAt ?? null,
      pr.lastReviewActivityAt ?? null,
      pr.sourceUrl,
    ],
  );
  const prDbId = result.rows[0]!.id;

  await client.query(`DELETE FROM pr_reviewer WHERE pr_id = $1`, [prDbId]);
  for (const r of pr.reviewers) {
    const reviewerDbId = personIdMap.get(r.personId);
    if (!reviewerDbId) continue;
    await client.query(`INSERT INTO pr_reviewer (pr_id, person_id, is_solo_request) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [
      prDbId,
      reviewerDbId,
      r.isSoloRequest,
    ]);
  }

  await client.query(`DELETE FROM pr_review_event WHERE pr_id = $1`, [prDbId]);
  for (const e of pr.reviewEvents) {
    const eventPersonDbId = e.personId ? (personIdMap.get(e.personId) ?? null) : null;
    await client.query(`INSERT INTO pr_review_event (pr_id, person_id, kind, at) VALUES ($1,$2,$3,$4)`, [
      prDbId,
      eventPersonDbId,
      e.kind,
      e.at,
    ]);
  }

  return prDbId;
}

async function replaceCiRuns(client: PoolClient, prDbId: string, ciRuns: CiRun[]): Promise<void> {
  await client.query(`DELETE FROM ci_run WHERE pr_id = $1`, [prDbId]);
  for (const run of ciRuns) {
    await client.query(
      `INSERT INTO ci_run (pr_id, check_name, status, is_required, started_at, completed_at, source_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [prDbId, run.checkName, run.status, run.isRequired, run.startedAt ?? null, run.completedAt ?? null, run.sourceUrl],
    );
  }
}

async function upsertCommit(client: PoolClient, teamId: string, commit: Commit, authorDbId: string | null): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO commit (team_id, sha, repo, branch, author_person_id, message, committed_at, source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (team_id, repo, sha) DO UPDATE SET
       branch = EXCLUDED.branch, author_person_id = EXCLUDED.author_person_id, message = EXCLUDED.message,
       committed_at = EXCLUDED.committed_at, source_url = EXCLUDED.source_url
     RETURNING id`,
    [teamId, commit.sha, commit.repo, commit.branch ?? null, authorDbId, commit.message, commit.committedAt, commit.sourceUrl],
  );
  return result.rows[0]!.id;
}

async function upsertLink(client: PoolClient, issueDbId: string, prDbId: string, link: Link): Promise<void> {
  await client.query(
    `INSERT INTO link (issue_id, pr_id, link_source, confidence) VALUES ($1,$2,$3,$4)
     ON CONFLICT (issue_id, pr_id) DO UPDATE SET link_source = EXCLUDED.link_source, confidence = EXCLUDED.confidence`,
    [issueDbId, prDbId, link.linkSource, link.confidence],
  );
}

/** Persists a fully-normalized sync bundle. Runs in one transaction so a failed sync never leaves partial state. */
export async function syncTeamState(teamId: string, bundle: SyncBundle): Promise<void> {
  await withTransaction(async (client) => {
    const personIdMap = new Map<string, string>();
    for (const person of bundle.people) {
      personIdMap.set(person.id, await upsertPerson(client, teamId, person));
    }

    const sprintDbId = bundle.sprint ? await upsertSprint(client, teamId, bundle.sprint) : null;
    const sprintIdBySyntheticId = new Map<string, string>();
    if (bundle.sprint && sprintDbId) sprintIdBySyntheticId.set(bundle.sprint.id, sprintDbId);

    const issueIdMap = new Map<string, string>();
    for (const issue of bundle.issues) {
      const assigneeDbId = issue.assigneePersonId ? (personIdMap.get(issue.assigneePersonId) ?? null) : null;
      const sprintDbIdForIssue = issue.sprintId ? (sprintIdBySyntheticId.get(issue.sprintId) ?? null) : null;
      issueIdMap.set(issue.id, await upsertIssue(client, teamId, issue, assigneeDbId, sprintDbIdForIssue, personIdMap));
    }

    const prIdMap = new Map<string, string>();
    for (const pr of bundle.pullRequests) {
      const authorDbId = pr.authorPersonId ? (personIdMap.get(pr.authorPersonId) ?? null) : null;
      const prDbId = await upsertPullRequest(client, teamId, pr, authorDbId, personIdMap);
      prIdMap.set(pr.id, prDbId);

      const ciRunsForPr = bundle.ciRuns.filter((run) => run.prId === pr.id);
      await replaceCiRuns(client, prDbId, ciRunsForPr);
    }

    for (const commit of bundle.commits) {
      const authorDbId = commit.authorPersonId ? (personIdMap.get(commit.authorPersonId) ?? null) : null;
      await upsertCommit(client, teamId, commit, authorDbId);
    }

    for (const link of bundle.links) {
      const issueDbId = issueIdMap.get(link.issueId);
      const prDbId = prIdMap.get(link.prId);
      if (!issueDbId || !prDbId) continue;
      await upsertLink(client, issueDbId, prDbId, link);
    }
  });
}

/** Reassembles TeamState from Postgres — the only thing the pure rule engine ever reads (drift-rules-spec.md §0). */
export async function loadTeamState(teamId: string): Promise<TeamState> {
  const [peopleRes, issuesRes, transitionsRes, prsRes, reviewersRes, reviewEventsRes, commitsRes, ciRunsRes, linksRes, sprintRes] =
    await Promise.all([
      pool.query(
        `SELECT p.id, p.display_name, p.email, im.jira_account_id, im.github_login FROM person p JOIN identity_map im ON im.person_id = p.id WHERE p.team_id = $1`,
        [teamId],
      ),
      pool.query(`SELECT * FROM issue WHERE team_id = $1`, [teamId]),
      pool.query(`SELECT it.* FROM issue_transition it JOIN issue i ON i.id = it.issue_id WHERE i.team_id = $1 ORDER BY it.at`, [
        teamId,
      ]),
      pool.query(`SELECT * FROM pull_request WHERE team_id = $1`, [teamId]),
      pool.query(`SELECT pr.* FROM pr_reviewer pr JOIN pull_request p ON p.id = pr.pr_id WHERE p.team_id = $1`, [teamId]),
      pool.query(`SELECT re.* FROM pr_review_event re JOIN pull_request p ON p.id = re.pr_id WHERE p.team_id = $1`, [teamId]),
      pool.query(`SELECT * FROM commit WHERE team_id = $1`, [teamId]),
      pool.query(`SELECT cr.* FROM ci_run cr JOIN pull_request p ON p.id = cr.pr_id WHERE p.team_id = $1`, [teamId]),
      pool.query(
        `SELECT l.* FROM link l JOIN issue i ON i.id = l.issue_id JOIN pull_request p ON p.id = l.pr_id WHERE i.team_id = $1`,
        [teamId],
      ),
      pool.query(`SELECT * FROM sprint WHERE team_id = $1 AND state = 'active' LIMIT 1`, [teamId]),
    ]);

  const transitionsByIssue = new Map<string, { fromStatus: string | null; toStatus: string; at: string; actorPersonId?: string }[]>();
  for (const row of transitionsRes.rows) {
    const list = transitionsByIssue.get(row.issue_id) ?? [];
    list.push({
      fromStatus: row.from_status,
      toStatus: row.to_status,
      at: row.at.toISOString(),
      actorPersonId: row.actor_person_id ?? undefined,
    });
    transitionsByIssue.set(row.issue_id, list);
  }

  const issues: Issue[] = issuesRes.rows.map((row) => ({
    id: row.id,
    key: row.key,
    title: row.title,
    status: row.status,
    statusCategory: row.status_category,
    assigneePersonId: row.assignee_person_id ?? undefined,
    sprintId: row.sprint_id ?? undefined,
    points: row.points !== null ? Number(row.points) : undefined,
    issueType: row.issue_type ?? undefined,
    lastTransitionAt: row.last_transition_at?.toISOString(),
    lastTouchedAt: row.last_touched_at?.toISOString(),
    sourceUrl: row.source_url,
    transitions: transitionsByIssue.get(row.id) ?? [],
  }));

  const reviewersByPr = new Map<string, { personId: string; isSoloRequest: boolean }[]>();
  for (const row of reviewersRes.rows) {
    const list = reviewersByPr.get(row.pr_id) ?? [];
    list.push({ personId: row.person_id, isSoloRequest: row.is_solo_request });
    reviewersByPr.set(row.pr_id, list);
  }

  const reviewEventsByPr = new Map<string, { personId?: string; kind: string; at: string }[]>();
  for (const row of reviewEventsRes.rows) {
    const list = reviewEventsByPr.get(row.pr_id) ?? [];
    list.push({ personId: row.person_id ?? undefined, kind: row.kind, at: row.at.toISOString() });
    reviewEventsByPr.set(row.pr_id, list);
  }

  const pullRequests: PullRequest[] = prsRes.rows.map((row) => ({
    id: row.id,
    repo: row.repo,
    number: row.number,
    title: row.title,
    state: row.state,
    isDraft: row.is_draft,
    authorPersonId: row.author_person_id ?? undefined,
    readyForReviewAt: row.ready_for_review_at?.toISOString(),
    mergedAt: row.merged_at?.toISOString(),
    closedAt: row.closed_at?.toISOString(),
    lastReviewActivityAt: row.last_review_activity_at?.toISOString(),
    sourceUrl: row.source_url,
    reviewers: reviewersByPr.get(row.id) ?? [],
    reviewEvents: (reviewEventsByPr.get(row.id) ?? []) as PullRequest["reviewEvents"],
  }));

  const commits: Commit[] = commitsRes.rows.map((row) => ({
    id: row.id,
    sha: row.sha,
    repo: row.repo,
    branch: row.branch ?? undefined,
    authorPersonId: row.author_person_id ?? undefined,
    message: row.message,
    committedAt: row.committed_at.toISOString(),
    sourceUrl: row.source_url,
  }));

  const ciRuns: CiRun[] = ciRunsRes.rows.map((row) => ({
    id: row.id,
    prId: row.pr_id,
    checkName: row.check_name,
    status: row.status,
    isRequired: row.is_required,
    startedAt: row.started_at?.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    sourceUrl: row.source_url,
  }));

  const links: Link[] = linksRes.rows.map((row) => ({
    issueId: row.issue_id,
    prId: row.pr_id,
    linkSource: row.link_source,
    confidence: Number(row.confidence),
  }));

  const people: Person[] = peopleRes.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email ?? undefined,
    jiraAccountId: row.jira_account_id ?? undefined,
    githubLogin: row.github_login ?? undefined,
  }));

  const sprintRow = sprintRes.rows[0];
  const sprint: Sprint | null = sprintRow
    ? {
        id: sprintRow.id,
        name: sprintRow.name,
        state: sprintRow.state,
        startAt: sprintRow.start_at?.toISOString(),
        endAt: sprintRow.end_at?.toISOString(),
        committedPoints: Number(sprintRow.committed_points),
      }
    : null;

  return { issues, pullRequests, commits, ciRuns, people, sprint, links };
}
