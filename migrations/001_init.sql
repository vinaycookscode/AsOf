-- AsOf schema — design-spec.md §3.1
-- Deterministic zone: this schema holds facts only. No per-person metrics table
-- exists by design (design-spec.md §3.2) — that is the privacy stance, structurally.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE team (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name              text NOT NULL,
  timezone          text NOT NULL DEFAULT 'UTC',
  brief_time        time NOT NULL DEFAULT '08:30',
  slack_channel_id  text
);

CREATE TABLE person (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  email         text
);

CREATE TABLE identity_map (
  person_id         uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  jira_account_id   text,
  github_login      text,
  slack_user_id     text,
  match_confidence  numeric(3,2) CHECK (match_confidence BETWEEN 0 AND 1),
  confirmed_by      uuid REFERENCES person(id)
);

CREATE UNIQUE INDEX identity_map_jira_account_id_idx ON identity_map (jira_account_id) WHERE jira_account_id IS NOT NULL;
CREATE UNIQUE INDEX identity_map_github_login_idx ON identity_map (github_login) WHERE github_login IS NOT NULL;

CREATE TABLE sprint (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name              text NOT NULL,
  state             text NOT NULL CHECK (state IN ('future', 'active', 'closed')),
  start_at          timestamptz,
  end_at            timestamptz,
  committed_points  numeric NOT NULL DEFAULT 0
);

CREATE TABLE issue (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  key                  text NOT NULL,
  title                text NOT NULL,
  status               text NOT NULL,               -- raw Jira status string, display only
  status_category      text NOT NULL CHECK (status_category IN ('done', 'in_progress', 'blocked', 'other')),
  assignee_person_id   uuid REFERENCES person(id),
  sprint_id            uuid REFERENCES sprint(id),
  points               numeric,
  issue_type           text,
  last_transition_at   timestamptz,
  last_touched_at      timestamptz,
  source_url           text NOT NULL,
  raw_updated_at       timestamptz NOT NULL,
  UNIQUE (team_id, key)
);

CREATE INDEX issue_team_status_category_idx ON issue (team_id, status_category);
CREATE INDEX issue_sprint_idx ON issue (sprint_id);

CREATE TABLE issue_transition (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id         uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  from_status      text,
  to_status        text NOT NULL,
  at               timestamptz NOT NULL,
  actor_person_id  uuid REFERENCES person(id)
);

CREATE INDEX issue_transition_issue_idx ON issue_transition (issue_id, at);

CREATE TABLE pull_request (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  repo                     text NOT NULL,
  number                   integer NOT NULL,
  title                    text NOT NULL,
  state                    text NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
  is_draft                 boolean NOT NULL DEFAULT false,
  author_person_id         uuid REFERENCES person(id),
  ready_for_review_at      timestamptz,
  merged_at                timestamptz,
  closed_at                timestamptz,
  last_review_activity_at  timestamptz,
  source_url               text NOT NULL,
  UNIQUE (team_id, repo, number)
);

CREATE INDEX pull_request_team_state_idx ON pull_request (team_id, state);

CREATE TABLE pr_reviewer (
  pr_id           uuid NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  is_solo_request boolean NOT NULL DEFAULT false,
  PRIMARY KEY (pr_id, person_id)
);

CREATE TABLE pr_review_event (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id      uuid NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
  person_id  uuid REFERENCES person(id),
  kind       text NOT NULL CHECK (kind IN ('approved', 'changes_requested', 'commented')),
  at         timestamptz NOT NULL
);

CREATE INDEX pr_review_event_pr_idx ON pr_review_event (pr_id, at);

CREATE TABLE commit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  sha              text NOT NULL,
  repo             text NOT NULL,
  branch           text,
  author_person_id uuid REFERENCES person(id),
  message          text NOT NULL,
  committed_at     timestamptz NOT NULL,
  source_url       text NOT NULL,
  UNIQUE (team_id, repo, sha)
);

CREATE INDEX commit_branch_idx ON commit (team_id, repo, branch);
CREATE INDEX commit_committed_at_idx ON commit (team_id, committed_at);

CREATE TABLE ci_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id         uuid NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
  check_name    text NOT NULL,
  status        text NOT NULL CHECK (status IN ('success', 'failure', 'pending', 'error', 'skipped')),
  is_required   boolean NOT NULL DEFAULT true,
  started_at    timestamptz,
  completed_at  timestamptz,
  source_url    text NOT NULL
);

CREATE INDEX ci_run_pr_idx ON ci_run (pr_id, completed_at);

-- PR <-> issue resolution (src/linking). confidence 0-1; link_source ranks explicit > branch_name/commit_ref > fuzzy.
CREATE TABLE link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  pr_id       uuid NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
  link_source text NOT NULL CHECK (link_source IN ('explicit', 'branch_name', 'commit_ref', 'fuzzy')),
  confidence  numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id, pr_id)
);

CREATE INDEX link_pr_idx ON link (pr_id);

CREATE TABLE sprint_scope_event (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES sprint(id) ON DELETE CASCADE,
  issue_id  uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  action    text NOT NULL CHECK (action IN ('added', 'removed')),
  points    numeric,
  at        timestamptz NOT NULL
);

CREATE INDEX sprint_scope_event_sprint_idx ON sprint_scope_event (sprint_id, at);

-- finding.evidence is non-negotiable (design invariant #3 / README): every finding
-- carries >= 1 evidence link, enforced here, not just convention.
CREATE TABLE finding (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  rule_id      text NOT NULL CHECK (rule_id IN ('D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8')),
  severity     text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  dedupe_key   text NOT NULL,
  message      text NOT NULL,
  entity_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence     jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'corrected', 'ignored', 'snoozed')),
  detected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  CONSTRAINT finding_evidence_nonempty CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) >= 1)
);

-- One open finding per (team, dedupe_key) — re-detecting the same drift updates, not duplicates.
CREATE UNIQUE INDEX finding_open_dedupe_idx ON finding (team_id, dedupe_key) WHERE status = 'open';
CREATE INDEX finding_team_status_idx ON finding (team_id, status);

CREATE TABLE feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid NOT NULL REFERENCES finding(id) ON DELETE CASCADE,
  action           text NOT NULL CHECK (action IN ('correct', 'ignore', 'snooze')),
  actor_person_id  uuid REFERENCES person(id),
  at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_finding_idx ON feedback (finding_id);

CREATE TABLE suppression (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  rule_id                text NOT NULL CHECK (rule_id IN ('D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8')),
  scope                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason                 text,
  created_from_feedback_id uuid REFERENCES feedback(id)
);

CREATE TABLE brief (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  date               date NOT NULL,
  content            text NOT NULL,
  findings_included  jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivered_at       timestamptz,
  UNIQUE (team_id, date)
);

CREATE TABLE rule_config (
  team_id         uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  rule_id         text NOT NULL CHECK (rule_id IN ('D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8')),
  enabled         boolean NOT NULL DEFAULT true,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  slack_delivery  text NOT NULL DEFAULT 'high_only' CHECK (slack_delivery IN ('high_only', 'all', 'none')),
  PRIMARY KEY (team_id, rule_id)
);

-- Append-only deltas from every sync — powers "what changed since yesterday" (design-spec §3.2).
CREATE TABLE event_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('issue', 'pull_request', 'commit', 'ci_run', 'finding')),
  entity_id    uuid NOT NULL,
  change       jsonb NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_log_team_at_idx ON event_log (team_id, at);
