# AsOf — Drift Rules Specification v1.0 (D1–D8)

**Status:** Final for MVP · closes P1 task "Specify drift rules D1–D8"
**Contract:** Every rule is a pure function `(TeamState, RuleConfig) → Finding[]`. Rules never call the LLM. The LLM never creates findings — it only ranks, groups, and narrates them. Every Finding must be verifiable by a human in one click via its evidence links.

---

## 0. Shared Definitions

**TeamState inputs** (from the normalized store): `issues[]`, `pull_requests[]`, `commits[]`, `ci_runs[]`, `people[]` (with identity_map), `sprint` (active sprint: start, end, committed_points), `links[]` (PR↔issue with `link_source`: explicit | branch_name | commit_ref | fuzzy, and `confidence` 0–1).

**Business days.** All "N days" thresholds count business days (Mon–Fri), team-timezone. Configurable per team later; MVP hardcodes Mon–Fri.

**Linking gate.** Rules that depend on a PR↔issue link (D1, D2, D6) only fire when `link.confidence ≥ 0.8`. Below that, no finding — a wrong accusation costs more than a miss (NFR-2). Fuzzy links (LLM-assisted) at any confidence never trigger High-severity findings in MVP; they only support Medium/Low.

**Finding schema (all rules):**
```
finding {
  rule_id: "D1".."D8"
  severity: high | medium | low
  entity_refs: [issue_key?, pr_number?, commit_sha?, person_id?]
  evidence: [{label, source_url}]        // ≥ 1, always
  message: rendered template (below)
  detected_at, resolved_at?, status: open|corrected|ignored|snoozed
  dedupe_key: rule_id + primary entity   // one open finding per key
}
```

**Neutral-language rule (binding).** Templates describe *state disagreement*, never person behavior. Banned framings: "X hasn't worked", "X forgot", "X is behind". Allowed: "the board and the repo disagree", "no activity recorded on".

**Resolution.** Each rule defines an auto-resolve condition. On the next sync where the condition no longer holds, the finding flips to `corrected` and is reported as resolved in the next brief ("✓ D1 on TICKET-142 resolved: PR #88 merged").

---

## D1 · Done-but-not-merged — HIGH

**Condition.** `issue.status ∈ done_statuses` (default: Done, Closed, Resolved — mapped per team's workflow at onboarding) AND ∃ linked PR with `pr.state ∈ {open, draft}` AND `link.confidence ≥ 0.8` AND `link_source ≠ fuzzy`.
**Grace period.** 4 working hours after the status transition (people often move the ticket seconds before merging).
**Evidence.** Issue (status + transition timestamp) · PR (state, last update).
**Template.** "{issue_key} is marked {status}, but linked {pr_ref} is still {pr_state}."
**Auto-resolve.** PR merged/closed, or issue moved out of done_statuses, or link removed.
**FP traps.** Teams that close tickets when code review starts (workflow mapping at onboarding must catch this); PRs intentionally left open for docs. Suppression: per-issue-type (e.g., ignore for `type = chore`).

## D2 · Zombie In-Progress — HIGH

**Condition.** `issue.status ∈ in_progress_statuses` AND age_in_status ≥ N days (default 3) AND no commits on any linked branch/PR AND no issue comments/transitions by anyone in the same window.
**Evidence.** Issue (last transition) · most recent commit on linked work if any ("last activity {date}") · else "no linked branch found".
**Template.** "{issue_key} has shown no recorded activity for {n} working days while In Progress."
**Auto-resolve.** Any commit, comment, transition, or PR event touching the issue.
**FP traps.** Work happening outside git (design, research, pairing on someone else's branch); assignee on leave. This rule will generate the most "intentional, ignore" feedback — it is the primary input to per-team threshold tuning. Default N=3 is deliberately loose; teams tighten it.
**Note.** Fires on the *issue*, never phrased about the assignee, even though the standup view will surface it under their column.

## D3 · Silent PR — MEDIUM

**Condition.** `pr.state = open` AND NOT draft AND review requested (or team convention: all PRs need review) AND no review activity (comment, approval, change-request) for X days (default 2) since ready-for-review.
**Evidence.** PR (opened/ready timestamp, requested reviewers).
**Template.** "{pr_ref} has been awaiting review for {x} working days with no review activity."
**Auto-resolve.** Any review event, or PR merged/closed/converted to draft.
**FP traps.** Stacked PRs waiting by design; bot PRs (dependabot etc. — excluded by author allowlist).

## D4 · Orphan work — MEDIUM

**Condition.** Branch or commit stream references an issue key (branch name or commit message regex `[A-Z]+-\d+`) where the issue is: not in the active sprint, OR unassigned, OR in a terminal status — AND activity in the last 2 days.
**Evidence.** Commit/branch (with the reference) · issue (its actual sprint/status).
**Template.** "Active work references {issue_key}, which is {not in the current sprint | unassigned | marked {status}}."
**Auto-resolve.** Issue pulled into sprint/assigned/reopened, or activity stops for 2 days (finding expires rather than resolves — expiry is silent, not celebrated).
**FP traps.** Long-running maintenance branches; keys referencing another team's project (filter to connected project keys only).

## D5 · Review overload — MEDIUM

**Condition.** One person is a requested reviewer on > K open, non-draft PRs (default 4), counted across connected repos.
**Evidence.** The list of PRs (each linked).
**Template.** "{k} open PRs are currently waiting on review from the same person." (Person named only inside the product, never in Slack delivery — Slack shows "one reviewer has {k} PRs queued", details on click-through.)
**Auto-resolve.** Count drops to ≤ K.
**FP traps.** CODEOWNERS auto-assignment inflating counts (dedupe by whether the person is the *only* requested reviewer vs one of several — weight solo-requests 1.0, shared 0.5).

## D6 · Red-but-moving — HIGH

**Condition.** Latest CI run on a linked PR is `failed` AND the linked issue had a *forward* transition (per the team's workflow order) after the failing run started.
**Evidence.** CI run (status, link) · issue transition (from → to, timestamp) · PR.
**Template.** "{issue_key} moved forward to {status} while CI on {pr_ref} is failing ({check_name})."
**Auto-resolve.** CI green on latest run, or issue moved back.
**FP traps.** Known-flaky checks (per-team allowlist of check names to ignore); CI failures on non-blocking checks (only checks marked required count, when the API exposes it; otherwise all, tunable).

## D7 · Scope creep — LOW (sprint-level)

**Condition.** Points (or count, if the team doesn't estimate) of issues added to the active sprint after sprint start > threshold % of committed (default 20%).
**Evidence.** The list of added issues with add-timestamps · sprint committed total.
**Template.** "{added_points} points ({pct}%) have been added to the sprint since it started (committed: {committed_points})."
**Auto-resolve.** Never auto-resolves mid-sprint; re-evaluated each sync, closes at sprint end. Fires at most once per sprint per threshold crossing.
**FP traps.** Teams that intentionally plan mid-sprint intake (rule off by default? No — on, Low severity, easy to ignore; the feedback loop will teach us).

## D8 · Stale board — LOW

**Condition.** Sprint active AND issue in sprint AND no transition, comment, or linked commit for N days (default 4) AND issue not in a terminal status. Excludes issues already flagged by D2 (dedupe: D2 wins).
**Evidence.** Issue (last touched timestamp).
**Template.** "{issue_key} hasn't been updated in {n} working days during an active sprint."
**Auto-resolve.** Any touch event.
**FP traps.** Placeholder/epic-child tickets; blocked-by-external tickets (teams should use a Blocked status — if `status ∈ blocked_statuses`, D8 is suppressed and the issue surfaces in the standup view's Blocked column instead, which is signal, not drift).

---

## Config Surface (per team, Settings screen)

| Key | Default | Range |
|---|---|---|
| done_statuses / in_progress_statuses / blocked_statuses | mapped at onboarding | any workflow states |
| d1.grace_hours | 4 | 0–24 |
| d2.days | 3 | 1–10 |
| d3.days | 2 | 1–10 |
| d4.enabled | true | bool |
| d5.max_open_reviews | 4 | 2–10 |
| d6.flaky_check_allowlist | [] | check names |
| d7.threshold_pct | 20 | 5–100 |
| d8.days | 4 | 2–15 |
| per-rule enabled + severity-gated Slack delivery | High only to Slack | — |

## Delivery & Ranking

Brief shows max 5 findings, ranked: severity → rule priority (D1 > D6 > D2 > D3 > D5 > D4 > D7 > D8) → age. Slack delivery: High severity only, by default. Everything visible in-app regardless. New finding + its resolution in the same day = shown as resolved, never flagged (don't punish fast fixes).

## Test Fixtures Required (P5 gate, written in P3–P4)

Per rule: one true-positive, one boundary (exactly at threshold — must NOT fire), one FP-trap case (must NOT fire), one resolution case. 32 fixtures minimum, fake Jira/GitHub payloads, run in CI.
