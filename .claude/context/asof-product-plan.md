# AsOf — Product Plan v1.0

**Product name:** AsOf — "as of right now, here's the real state."
**One-liner:** The standup killer. It reads your Jira and GitHub, detects where the board is lying, and answers everything a daily standup covers — in chat or a 2-minute voice brief.
**Date:** August 2026 · **Status:** Pre-MVP planning

---

## 1. Thesis and Positioning

Scrum boards show *claimed* state, not *actual* state. They are self-reported, updated late, and optimistic. Every existing tool either automates collecting the self-report (standup bots: Geekbot, DailyBot, Troopr) or renders the raw data into dashboards for VPs (engineering intelligence: Swarmia, LinearB, Jellyfish, Allstacks). Nobody does **adversarial cross-checking** — comparing what the board says against what the code, PRs, and CI actually show — and delivers the contradictions conversationally with cited evidence.

**Positioning statement:** For team leads running agile teams of 4–12 engineers, AsOf is an AI teammate that replaces the daily standup by detecting drift between reported and actual work state. Unlike dashboards, it answers questions in plain language with evidence. Unlike standup bots, it never asks a human for a status update.

**Anti-positioning (what we refuse to be):** Not a surveillance tool. No individual productivity scores, no hours tracking, no keystroke/activity metrics, no manager-only secret views. We report *work state*, never *worker performance*. This is a product principle, not a feature — it is what makes teams adopt instead of revolt.

---

## 2. Target Users and Personas

**Primary buyer & daily user — Lena, Team Lead / EM (team of 8).** Runs 1–2 squads. Spends the first 45 minutes of every day reconstructing reality: scanning the board, checking PRs, pinging people. Standup exists mostly for *her* benefit. She will pay $50–100/mo out of a team tools budget without procurement. Success for her: skip standup 3+ days a week, never be surprised in sprint review.

**Secondary user — the IC engineer.** Doesn't want another tool. Interacts only when mentioned in a drift flag ("your ticket says Done but the PR is unmerged — merge or move it back?") via Slack DM or a light web view. Must feel the tool is *fair*: everything it says about their work is visible to them, evidence-linked, and correctable with one click ("this is wrong / this is intentional").

**Tertiary — PM/Scrum Master.** Wants sprint-health answers without interrupting engineers. Read/ask access only.

**Explicit non-target for MVP:** VPs of Engineering wanting org-level metrics. That's the incumbents' game (DORA, cycle time). We sell to the team, not the org — bottom-up, credit-card pricing.

---

## 3. Requirements

### 3.1 Functional Requirements (MVP)

**FR-1 · Connect sources.** OAuth connect to one Jira project (Cloud) and one or more GitHub repos in ≤ 5 minutes, no admin install required where possible. Map Jira users ↔ GitHub users (auto-match by email/name, manual override UI).

**FR-2 · Continuous sync.** Poll/webhook ingestion of: Jira issues (status, assignee, sprint, transitions, comments metadata), GitHub commits, branches, PRs (state, reviews, linked issues), CI check results on PRs. Freshness target: ≤ 15 min behind reality.

**FR-3 · Drift detection engine.** Deterministic rules (see §4) run over the fused state. Each finding carries: rule ID, severity, human-readable claim, and evidence links (the exact ticket, PR, commit). LLM writes the narrative; rules produce the facts.

**FR-4 · Ask anything (chat).** Natural-language Q&A over team state: "who's blocked?", "what changed since yesterday?", "why is TICKET-142 slipping?", "will the sprint land?". Every factual claim in an answer must be traceable to a source link. If evidence is thin, the answer says so — no fabricated confidence.

**FR-5 · Morning brief.** Auto-generated daily digest per team: top 3 risks, drift findings, what merged/moved yesterday, one suggested intervention. Delivered as Slack message + web page; voice (TTS) playback of the same brief is a stretch goal in MVP, core in v1.1.

**FR-6 · Standup replacement view.** One screen that answers the three standup questions per person from evidence: shipped yesterday (merged PRs, closed tickets), in flight today (active branches/tickets), blocked (drift findings + stalled signals). Exportable/postable to Slack so teams can literally cancel the meeting.

**FR-7 · Feedback loop.** Every drift flag has "correct" / "intentional, ignore" / "snooze" actions. Ignored patterns train per-team suppression (e.g., "we never link PRs to tickets for chores").

**FR-8 · Team transparency.** Every team member sees everything the tool infers about the team, including about themselves. No hidden manager views. Audit page listing exactly what data is read.

### 3.2 Non-Functional Requirements

**NFR-1 · Privacy:** read-only scopes only; store metadata and diffs of state, never full code contents beyond what's needed for context (PR titles, file paths yes; file contents no in MVP). Slack message *content* is out of scope for MVP entirely. Data deletable on disconnect within 24h.
**NFR-2 · Trust/accuracy:** false-positive drift flags < 20% after 2 weeks of per-team tuning (measured via the FR-7 feedback actions). A wrong flag costs more trust than a missed one — tune conservative.
**NFR-3 · Latency:** chat answers < 8s p90; brief generation < 60s.
**NFR-4 · Cost ceiling:** LLM spend < $0.50/team/day at MVP scale (rules do detection; LLM only narrates and answers — cacheable).
**NFR-5 · Security:** tokens encrypted at rest, per-tenant isolation, SOC2 posture from day one (deferred audit, but architecture shouldn't need rework).

---

## 4. Drift Detection Spec (the core IP)

Deterministic rules over the fused graph. Each rule: condition → finding (severity, message template, evidence). MVP ships eight:

| ID | Rule | Signal logic | Severity |
|----|------|--------------|----------|
| D1 | Done-but-not-merged | Ticket status ∈ {Done, Closed} AND linked PR open/unmerged | High |
| D2 | Zombie In-Progress | Status = In Progress AND no commits/branch activity by assignee on linked work for N days (default 3) | High |
| D3 | Silent PR | PR open > X days (default 2) with no review activity | Medium |
| D4 | Orphan work | Commits/branch referencing a ticket that is unassigned or not in sprint | Medium |
| D5 | Review overload | One person is requested reviewer on > K open PRs (default 4) | Medium |
| D6 | Red-but-moving | CI failing on a PR while ticket moved forward on the board | High |
| D7 | Scope creep | Tickets added to active sprint after start > threshold % of committed points | Low |
| D8 | Stale board | Ticket untouched (no transition/comment/commit) for N days while sprint active | Low |

Design rules for the engine: every finding must be *checkable by a human in one click* (evidence-first); rules are per-team configurable (thresholds + on/off); the LLM never invents findings — it only ranks, groups, and narrates rule output. "Sprint will land?" in MVP = count/severity summary of open drift + remaining scope vs. days left, phrased as reasoning, **not** a probability number.

---

## 5. MVP Scope

**In:** Jira Cloud + GitHub connectors · drift engine (8 rules) · chat Q&A (web) · morning brief (Slack + web) · standup view · feedback loop · team transparency page · single-team workspaces · Slack *delivery* (posting briefs/flags — not reading messages).

**Out (v1.1+):** Slack/Teams message ingestion (the "unanswered question" signal) · calendar load · voice input · probability forecasts · Linear/GitLab/Azure DevOps connectors · multi-team/org rollups · mobile app.

**Cut-line rationale:** Jira+GitHub alone yields 6 of the 8 rules with high confidence and zero "reading my messages" perception risk. The wedge must be trust-safe on day one.

---

## 6. Tech Stack

**Connectors:** MCP servers per source (Atlassian MCP, GitHub MCP) wrapped by our own normalizing ingestion layer. MCP gives us free expansion (Slack, Linear, Calendar later) and lets power users point their own AI clients at us eventually.
**Backend/orchestration:** Node.js (TypeScript) + Fastify; BullMQ (Redis) for sync jobs and brief generation; webhooks where available, polling fallback.
**Data:** Postgres as system of record (tenants, tokens, normalized entities, findings, feedback); the "team-state graph" modeled as typed tables + a lightweight in-memory graph assembled per query — no dedicated graph DB in MVP (premature). Redis for cache/queues.
**LLM layer:** Anthropic API — Claude Sonnet for chat Q&A and brief narration, Haiku for cheap classification/entity linking (PR↔ticket matching beyond explicit links). Tool-use pattern: the model calls typed internal functions (`get_drift_findings`, `get_person_state`, `get_sprint_state`) rather than receiving a giant context dump — keeps answers grounded and cheap.
**Frontend:** React + TypeScript + Vite + Tailwind; single-page app; SSE for streaming chat answers.
**Voice (v1.1):** TTS for brief playback first (ElevenLabs or platform TTS); STT input later. Voice output is 10× easier than voice input and delivers the "Jarvis talks first" moment.
**Infra:** Fly.io or Railway for MVP (fast, cheap), Postgres managed; upgrade path to AWS when SOC2 matters. Sentry + PostHog for errors/analytics.

---

## 7. Architecture

```
             ┌────────────┐   ┌─────────────┐
  Jira ──────► Atlassian  │   │  GitHub MCP ◄────── GitHub
  (webhook/  │    MCP     │   │             │      (webhooks)
   poll)     └─────┬──────┘   └──────┬──────┘
                   ▼                 ▼
             ┌─────────────────────────────┐
             │  Ingestion & Normalization  │  Node.js workers (BullMQ)
             │  (entity resolution:        │
             │   user-map, PR↔ticket link) │
             └──────────────┬──────────────┘
                            ▼
             ┌─────────────────────────────┐
             │   Team-State Store (PG)     │  issues · prs · commits ·
             │   + change log (events)     │  ci_runs · people · links
             └──────┬───────────────┬──────┘
                    ▼               ▼
          ┌──────────────┐  ┌───────────────┐
          │ Drift Engine │  │ Query Service │◄── LLM tool-calls
          │ (rules D1-D8)│  │ (typed reads) │
          └──────┬───────┘  └───────┬───────┘
                 ▼                  ▼
             ┌─────────────────────────────┐
             │      LLM Reasoning Layer    │  narrate briefs · answer Q&A
             │      (Claude, tool-use)     │  rank findings · never invent
             └──────┬───────────────┬──────┘
                    ▼               ▼
             Slack delivery    Web app (chat, standup
             (briefs, flags)   view, findings, settings)
```

Key decisions: detection is deterministic and auditable (rules), language is generative (LLM) — the trust boundary between them is the product's backbone. Event/change log from day one enables "what changed since yesterday" and future timeline features cheaply.

---

## 8. Data Model (core entities)

`tenant` → `team` → `person` (with `identity_map`: jira_id, github_login, slack_id) · `issue` (status, assignee, sprint, points, transitions[]) · `pull_request` (state, author, reviewers, checks, linked_issue_id) · `commit` (author, branch, inferred_issue_id) · `ci_run` · `finding` (rule_id, severity, entity_refs[], status: open/corrected/ignored/snoozed, created_at) · `feedback` (finding_id, action, actor) · `brief` (date, content, findings_included[]). All entities carry `source_url` — evidence links are non-negotiable.

---

## 9. UX and UI

### Design principles
1. **Evidence or it didn't happen.** Every claim rendered with its source chip (JIRA-142 · PR #88). Click-through in one tap.
2. **Calm, not alarming.** Drift findings are phrased as observations ("board and repo disagree"), never accusations ("Priya hasn't worked"). Neutral language is a legal requirement of the privacy stance, enforced in prompt + copy review.
3. **Zero-input default.** The tool is useful with no one typing anything: brief arrives, standup view is always current. Chat is the power layer, not the entry fee.
4. **Fairness surface.** Anything shown to the lead about a person is visible to that person, with a correction affordance.

### Information architecture (web app)
Four screens only:
1. **Today** (default) — the morning brief rendered live: risk cards → drift findings → yesterday's movement → suggested intervention. Play button for TTS (v1.1).
2. **Standup** — grid by person: Shipped / In flight / Flags. "Post to Slack" button. This is the screen that kills the meeting.
3. **Ask** — chat with streaming answers, source chips inline, suggested prompts ("who's blocked?", "what changed?", "sprint status?").
4. **Settings** — connections, user mapping, rule thresholds/toggles, transparency page ("what we read, what we never read"), data deletion.

### Key flows
**Onboarding (target < 10 min):** Connect Jira → pick project → Connect GitHub → pick repos → auto user-matching with confirm screen → "we're syncing, your first brief arrives tomorrow 8:30am" → immediate teaser: show 1–2 drift findings from the initial sync so value lands in minute one.
**Drift flag → resolution:** Flag appears in brief/Slack → lead or IC clicks evidence → acts in Jira/GitHub → next sync auto-resolves the finding ("✓ resolved: PR merged") → resolution shown in tomorrow's brief. The loop closing visibly is what builds the habit.
**Slack DM to IC (opt-in per team):** gentle, self-serve phrasing — "TICKET-142 is marked Done but PR #88 is still open. Merge it, or should the ticket move back?" with buttons. Never CC the manager.

### Visual direction
Utilitarian-warm, not dashboard-corporate: single accent color, generous whitespace, monospace for entity IDs, severity as subtle left-border color (red/amber/neutral) rather than alarm badges. Dark mode at launch (developer audience). The brief should read like a well-written message from a sharp chief of staff, not a report.

---

## 10. Privacy by Design (product spec, not legalese)

Read-only OAuth scopes; we never write to Jira/GitHub in MVP (even auto-fix is deferred — suggestions only). No individual leaderboards, rankings, or time-based productivity metrics — the schema deliberately has no per-person aggregate metrics table. Slack content unread in MVP; when added in v1.1 it is per-channel opt-in, and we extract *signals* (question asked, no reply in 24h) not transcripts. Public transparency page in-product. Deletion: full tenant purge ≤ 24h. These commitments go on the marketing site verbatim — they are the moat against the "surveillance" objection that plagues LinearB-class tools.

---

## 11. Roadmap

**Phase 0 — Weekend prototype (now):** CLI/script: pull one Jira project + one repo via APIs, run rules D1–D3, print findings with links, pipe to Claude for a narrated brief. Goal: validate signal quality on a real team's data.
**Phase 1 — MVP (4–6 weeks):** Everything in §5. Run on 3–5 design-partner teams free. Success gate: ≥ 2 teams cancel standup ≥ 3 days/week; flag precision ≥ 80%.
**Phase 2 — v1.1 (weeks 7–12):** Voice brief playback · Slack signal ingestion (opt-in) · calendar load for the overload picture · Linear connector · paid launch ($49/team/mo flat, guess to validate).
**Phase 3 — v2:** Voice Q&A · "why" dependency tracing across tickets/PRs/threads · sprint outcome reasoning with historical calibration · multi-team.

## 12. Success Metrics

North star: **standups cancelled per team per week.** Supporting: flag precision (corrected vs. ignored ratio), brief open/listen rate, questions asked per lead per week, time-to-first-finding at onboarding, weekly retained teams.

## 13. Top Risks and Mitigations

1. **False positives kill trust** → conservative defaults, per-team tuning, feedback loop from day one, severity-gated delivery (only High goes to Slack initially).
2. **PR↔ticket linking is messy in real teams** → invest here first (explicit links, branch-name conventions, commit-message refs, then LLM-assisted fuzzy matching with confidence threshold); linking quality is the ceiling on everything else.
3. **Incumbent ships it as a feature** → move fast on the conversational/team-level form factor incumbents structurally avoid; own the "standup killer" phrase.
4. **Perceived surveillance** → §10 stance, marketed loudly; IC-first fairness features.
5. **Jira API rate limits / marketplace approval friction** → webhook-first design, polite polling, start with OAuth apps not marketplace listing.

---

## 14. Immediate Next Steps

1. Validate Phase 0 on a real team's Jira + GitHub (yours or a friendly team's) — one week.
2. Secure the domain and handles for AsOf (asof.dev / asof.app / getasof.com) and run a quick trademark check.
3. Write the D1–D8 rules as code with fixture tests (fake Jira/GitHub payloads).
4. Design the brief format (one great example, hand-written, before any generation code).
5. Recruit 3 design-partner team leads with the one-line pitch: "Cancel your standup. I'll show you what your board is hiding."
