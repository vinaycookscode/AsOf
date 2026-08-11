# AsOf — Design Specification v1.0 (Phase P2)

**Status:** Final for MVP · closes P2 tasks: north-star brief · UX flows · data model · architecture sign-off
**Inputs:** asof-product-plan.md · asof-drift-rules-spec.md
**Rule of thumb for everything below:** the brief in §1 is the north star. If a design decision elsewhere would degrade that artifact, the decision is wrong.

---

## 1. The North-Star Artifact — the morning brief

This is the hand-written reference. Generation code, prompts, UI layout, and (in v1.1) the TTS script are all reverse-engineered from it. It is *not* a template with slots — it is the quality bar.

---

> **☀️ AsOf brief — Atlas squad — Thu 6 Aug, 8:30am**
> *Sprint day 6 of 10 · 21 of 34 points remaining · 3 findings need eyes*
>
> **Needs a decision today**
>
> ● **NOVA-142 is marked Done, but PR #88 is still open.** The ticket moved yesterday 4:12pm; the PR has an approval but was never merged. One click to fix, or the sprint's "done" count is off by 3 points. `NOVA-142` `PR #88`
>
> ● **NOVA-137 has shown no recorded activity for 3 working days while In Progress.** No commits on its branch, no comments, no transitions since Monday. `NOVA-137`
>
> ○ **PR #91 has been waiting for review for 2 working days.** Two reviewers requested, no activity yet. It blocks NOVA-150, the sprint's largest remaining item. `PR #91` `NOVA-150`
>
> **Since yesterday**
>
> Merged: PR #86 (auth refactor, closes NOVA-131) · PR #89 (flaky test fix). Moved: NOVA-144 → In Review, NOVA-146 → In Progress. ✓ Resolved: yesterday's flag on NOVA-129 — PR #84 merged at 6:40pm.
>
> **One suggestion**
>
> If PR #91 gets reviewed this morning, NOVA-150 can land by Friday and the sprint stays on plan. That's the highest-leverage 20 minutes available today.
>
> *Reply here to ask anything — "why is 137 stalled?" works.*

---

### Why each element is there (binding constraints for the generator)

| Element | Constraint |
|---|---|
| Sprint clock in the subhead | Every finding needs context; "3 days stalled" means nothing without "day 6 of 10". |
| Max 5 findings, ranked | Per drift-spec §Delivery. Severity → rule priority → age. A brief that asks for everything gets nothing. |
| Severity as ● (high) / ○ (medium) | Subtle, scannable, renders in Slack and TTS-able ("high" / "worth noting"). No alarm badges, no emoji personality. |
| Evidence chips on every claim | Non-negotiable (design principle 1). No claim without a clickable source. |
| Neutral phrasing | "No recorded activity" — never "Priya hasn't worked". The generator must not add managerial advice about a *person* ("check in with them"), only about *work state*. |
| "Since yesterday" including resolutions | Closing loops visibly is what builds the habit. Resolved items get equal billing with new flags. |
| Exactly one suggestion | Tied to the highest-ranked finding, phrased as a consequence chain, never as an instruction to a named person. |
| Reply affordance | Converts a passive brief into the chat entry point at zero UI cost. |
| Length | ≤ 200 words body. Read time ~70s; TTS ~100s. Hard ceiling is the 2-minute promise. |

### Prompt contract (implementation note for B13)
Input: ranked findings JSON + sprint state + yesterday's deltas + resolved findings. The model **may not** introduce entities absent from the input, may not infer causes not present in evidence, and must render every entity reference as a chip. If findings are zero, the brief says so plainly ("Board and repo agree this morning — nothing needs a decision") and still reports movement.

---

## 2. UX Flows

### 2.1 Onboarding (target < 10 minutes)

```
Sign in (Google/GitHub SSO)
  → Connect Jira (OAuth 3LO)  → pick ONE project
  → Workflow mapping screen: drag your statuses into
      Done-ish / In-Progress-ish / Blocked-ish buckets      ← critical: D1 & D8 correctness depends on it
  → Connect GitHub (GitHub App) → pick repos
  → Identity match: auto-matched people shown with confidence;
      unmatched shown as a short "is this the same person?" list
  → Initial sync runs (progress shown, ~2-5 min)
  → TEASER: "Here are 2 things we already found" (live findings, evidence links)
  → Set brief time + Slack channel → done
```

**Design notes.** The workflow-mapping step is the one place we ask real cognitive work of the lead — it is unavoidable (teams that close tickets at code-review time would otherwise drown in false D1s) and it is framed as "teach AsOf your workflow", not configuration. The teaser is the moment value lands; if the initial sync yields zero findings we show what *was* checked instead ("we cross-checked 34 tickets against 12 open PRs — no disagreements today"), never an empty state.

### 2.2 Flag → resolution loop

```
Finding created (sync)
  → appears in-app immediately; High severity also posts to Slack channel
  → lead or IC clicks evidence chip → lands in Jira/GitHub
  → human acts (merge PR / move ticket / add comment)
  → next sync detects condition no longer holds
  → finding flips to `corrected`
  → tomorrow's brief reports it under "Since yesterday · ✓ Resolved"
```
Fast fixes (created and resolved same day) are shown as resolved and never flagged — we don't punish speed.

### 2.3 IC Slack DM (opt-in per team, default OFF for MVP)

Single message, self-serve, never CCs the lead:
> NOVA-142 is marked Done but PR #88 is still open. `[Open PR]` `[This is intentional]` `[Ticket should move back]`

"This is intentional" writes feedback and suppresses the finding; nothing is written to Jira/GitHub (read-only in MVP).

### 2.4 Screen inventory (four screens, per plan §9)

**Today** — brief rendered live. Order: sprint clock → findings (severity left-border) → Since yesterday → one suggestion. TTS play button ships v1.1.
**Standup** — grid, one row per person: Shipped (merged PRs, closed tickets) · In flight (active branches/tickets) · Flags (their findings). "Post to Slack" renders the same grid as a message. This is the screen that kills the meeting.
**Ask** — streaming chat, source chips inline, three suggested prompts. Empty state shows the prompts, not a blank box.
**Settings** — connections · identity map · rule thresholds & toggles (mirrors drift-spec config table) · transparency page · delete workspace.

### 2.5 Visual system
Dark mode default. Single accent (electric blue) used only for interactive elements. Severity = 3px left border: red (high) / amber (medium) / grey (low) — never background fills, never badges. Monospace for all entity IDs and chips. Generous line height; the brief should read like prose, not a dashboard. No charts anywhere in MVP — a chart is an admission that we failed to say the thing.

---

## 3. Data Model

### 3.1 Core tables

```sql
tenant(id, name, created_at, deleted_at)
team(id, tenant_id, name, timezone, brief_time, slack_channel_id)
person(id, team_id, display_name, email)
identity_map(person_id, jira_account_id, github_login, slack_user_id, match_confidence, confirmed_by)

issue(id, team_id, key, title, status, status_category,   -- category from workflow mapping
      assignee_person_id, sprint_id, points, issue_type,
      last_transition_at, last_touched_at, source_url, raw_updated_at)
issue_transition(id, issue_id, from_status, to_status, at, actor_person_id)

pull_request(id, team_id, repo, number, title, state, is_draft, author_person_id,
             ready_for_review_at, merged_at, closed_at, last_review_activity_at, source_url)
pr_reviewer(pr_id, person_id, is_solo_request)            -- feeds D5 weighting
pr_review_event(id, pr_id, person_id, kind, at)

commit(id, team_id, sha, repo, branch, author_person_id, message, committed_at, source_url)
ci_run(id, pr_id, check_name, status, is_required, started_at, completed_at, source_url)

link(id, issue_id, pr_id, link_source, confidence, created_at)   -- explicit|branch_name|commit_ref|fuzzy
sprint(id, team_id, name, state, start_at, end_at, committed_points)
sprint_scope_event(id, sprint_id, issue_id, action, points, at)  -- feeds D7

finding(id, team_id, rule_id, severity, dedupe_key, message, entity_refs jsonb,
        evidence jsonb, status, detected_at, resolved_at)
feedback(id, finding_id, action, actor_person_id, at)     -- correct|ignore|snooze
suppression(id, team_id, rule_id, scope jsonb, reason, created_from_feedback_id)
brief(id, team_id, date, content, findings_included jsonb, delivered_at)
rule_config(team_id, rule_id, enabled, params jsonb, slack_delivery)
event_log(id, team_id, entity_type, entity_id, change jsonb, at)  -- powers "what changed since yesterday"
```

### 3.2 Modeling decisions

**`status_category` is derived, not raw.** Jira status strings are per-team chaos; every rule reads the mapped category (done / in_progress / blocked / other) set during onboarding. Raw status is kept for display only.

**`event_log` from day one.** Append-only deltas on every sync. It powers "what changed since yesterday", the resolution ribbon, and future timeline features — and it is far cheaper to write now than to backfill.

**No per-person metrics table, deliberately.** The schema has no place to accumulate a productivity score. This is the privacy stance expressed structurally: someone would have to add a table to violate it, and that is a reviewable act.

**Every entity carries `source_url`.** Evidence links are not decoration; a row without one cannot appear in a finding.

**Deletion.** `tenant.deleted_at` triggers a cascade purge job; target ≤ 24h (NFR-1). Tokens are in a separate encrypted store, purged first.

---

## 4. Architecture Sign-Off

### 4.1 The trust boundary (the product's backbone)

```
Deterministic zone            |  Generative zone
------------------------------|--------------------------------
Ingestion & normalization     |  Brief narration
Entity resolution / linking   |  Chat Q&A
Drift rules D1–D8             |  Finding grouping & phrasing
Finding lifecycle             |
Evidence assembly             |
```

**Rules produce facts. The LLM produces sentences.** The model receives findings and typed query results; it never receives raw source data to "look for problems in", and it has no tool that creates a finding. Every claim it renders traces to a `finding.evidence` entry or a query-service response. This is what makes wrong output a bug we can fix rather than a hallucination we can only apologize for.

### 4.2 Query service (the LLM's only door to data)

Typed functions, each returning evidence-bearing rows: `get_drift_findings(filters)` · `get_person_state(person, window)` · `get_sprint_state()` · `get_changes_since(timestamp)` · `get_entity(issue|pr)`. No free-form SQL, no giant context dumps. Cheap, cacheable, groundable — and it caps token spend against NFR-4.

### 4.3 Sync design
Webhook-first (Jira webhooks, GitHub App events) with a polite polling fallback per team (default 10 min, backoff on 429). Freshness target ≤ 15 min. Rules run after each ingestion batch, not on a separate schedule, so findings and data never disagree.

### 4.4 Decisions recorded
- **No graph DB in MVP.** Typed tables + an in-memory graph assembled per query. Revisit only if "why" tracing (v2) demands it.
- **MCP servers wrapped, not used raw.** Our normalization layer owns the schema; MCP is an adapter. This keeps Linear/GitLab additions cheap without leaking vendor shapes into the rules.
- **Read-only everywhere in MVP.** No writes to Jira/GitHub, even for "obvious" fixes. Suggestions only. Revisit after trust is established (earliest v1.2).
- **Single-team workspaces.** Multi-team rollups are explicitly a v2 concern; tenant/team tables exist so it isn't a rewrite.

---

## 5. P2 Exit Criteria — met

| Criterion | Status |
|---|---|
| Clickable flow map | §2 flows specified (onboarding, resolution loop, IC DM, 4 screens) |
| One great example brief, hand-written | §1, with binding constraints for the generator |
| Schema frozen | §3 DDL + modeling decisions |
| Architecture doc signed off | §4 trust boundary, query service, sync, recorded decisions |

**Feeds directly into:** B6 (schema), B9 (rule framework contract), B13 (brief narrator prompt), B27 (query service), B31–B34 (frontend screens).
