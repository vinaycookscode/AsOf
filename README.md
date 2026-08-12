# AsOf

> As of right now, here's the real state.

Detects **drift** between what your Jira board claims and what your GitHub repos actually show, then narrates it. Rules find the facts; the LLM only writes the sentences.

**Phase:** P3 prototype (see `asof-delivery-tracker.xlsx`)

## Status

| Backlog | Item | State |
|---|---|---|
| B1 | Monorepo scaffolding (TS, tsconfig, scripts) | done |
| B2 | Migration tooling + pool | done |
| B3 | Jira client (issues, transitions, sprint, statuses) | done |
| B4 | GitHub client (PRs, reviews, commits, check runs) | done |
| B5 | Retry / rate-limit layer | done |
| B6 | Schema (migrations/001_init.sql) | done |
| B7–B8 | Linking (explicit, branch, commit-ref) | done |
| B9–B12 | Rule framework + D1, D2, D3 | done |
| B13 | Brief narrator | done |
| B14 | CLI runner | code done; **first real sync+drift run completed** (see below) — GO/NO-GO gate still needs your usefulness judgment |
| B27 | Query service (Fastify API: /api/today, /api/standup) | done |
| B31 | Today screen (web) | done |
| B32 | Standup screen (web) | done |
| B28 | Chat Q&A (tool-use) + Jarvis voice screen | done (see caveats below) |
| B20–B24 | Rules D4–D8 (orphan work, review overload, red-but-moving, scope creep, stale board) | done — see caveats below |
| B25 | Auto-resolve pass + finding lifecycle (open ↔ corrected) | done — verified live (see caveats below); ignored/snoozed are B35 |
| B35 | Correct/ignore/snooze feedback actions + suppression store | done — verified live (see caveats below) |
| B36 | 32+ rule fixtures (TP/boundary/FP-trap/resolution) in CI | done — 35 fixtures across D1–D8, `.github/workflows/ci.yml` runs `npm test` |
| B19 | Fuzzy PR↔ticket matching via Haiku | done — opt-in, runs only when `ANTHROPIC_API_KEY` is set |

## Setup

```bash
npm install
cp .env.example .env      # fill in Jira, GitHub, Anthropic credentials
createdb asof              # or point DATABASE_URL anywhere
npm run migrate
```

Jira token: id.atlassian.com → Security → API tokens.
GitHub token: a **read-only** PAT with `repo:status`, `public_repo` (or `repo` for private).

**No Jira/GitHub credentials yet?** `npm run sync` falls back to a bundled demo fixture
(`test/fixtures/demoTeam.ts`, modeled on the design-spec north-star brief) so the full
`sync → drift → brief` pipeline is runnable and verifiable end-to-end before you connect a
real team. This is not the P3 GO/NO-GO gate — that requires a real team's data and a lead's
judgment (see Dev Backlog B14). `ASOF_DEMO_PHASE=2 npm run sync` re-syncs with PR #84 merged,
to see a finding auto-resolve.

## Commands

```bash
npm run sync     # pull Jira + GitHub into Postgres
npm run drift    # run rules, print findings with evidence links
npm run brief    # narrate findings into the morning brief
npm run api      # Fastify query service on :4000 (Today + Standup screens' only data source)
npm run web      # Vite dev server on :5173 (proxies /api -> :4000)
npm test         # rule fixtures
```

Brief narration prefers Anthropic (`ANTHROPIC_API_KEY`); falls back to a local Ollama model
(`OLLAMA_MODEL`, e.g. `qwen2.5:14b`) if set; otherwise prints the structured facts as JSON.
Same entity-hallucination guard applies regardless of which model narrates.

### Jarvis (voice Q&A)

The **Jarvis** tab in the web app listens continuously (Web Speech API) for the wake phrase
**"Hey Jarvis"** — say it alone and it prompts "What status are you looking for?"; say it with
the question attached ("Hey Jarvis, how is Wei doing?") and it skips straight to answering.
Anything said without the wake phrase is ignored, so ambient conversation doesn't trigger it.
Questions go to `POST /api/ask`, a bounded tool-use loop (`src/llm/ask.ts`,
`src/llm/queryTools.ts`) over the same query functions the Today/Standup screens use, then the
answer is read aloud (`speechSynthesis`). Uses whichever LLM is configured (Anthropic or
Ollama), same entity-hallucination guard as the brief narrator. Typing a question always
bypasses the wake word — typing is already an explicit action.

Visual is full-screen: ~110 dots scattered edge-to-edge across the viewport (`JarvisDots.tsx`),
each blinking on its own randomized cycle, color and speed shifting with state (blue calm at
rest, faster while thinking, red if the mic is denied/unsupported) — an ambient field standing
in for the single-ring orb of the first version. No transcript or "heard" text is shown in the
UI by design; only the spoken answer appears, briefly, once ready.

**Caveats:**
- Continuous speech recognition needs Chrome or Edge; Safari/Firefox support is unreliable. A
  text-input fallback is always shown, and works everywhere.
- **Local models can drift into the wrong language mid-answer.** Observed with `qwen2.5:14b`
  on this machine: identical questions sometimes came back in Thai instead of English, even
  with an explicit "respond only in English" instruction in the system prompt — better after
  adding it, not eliminated. Entity grounding held regardless (same correct `NOVA-*`/`PR #*`
  references every time), but a voice assistant answering in a random language sometimes is a
  real reliability gap. Anthropic didn't exhibit this in testing; if it recurs, it's a strong
  argument for switching this feature to a hosted model.
- **Wake-word matching is fuzzy on purpose.** "Jarvis" is an uncommon proper noun and Chrome's
  speech-to-text frequently mishears it ("Jervis", "Charvis", "Garvis" all observed). Matching
  falls back to "hey \<word\>" where \<word\> is within Levenshtein distance 2 of "jarvis" —
  verified against real Chrome via a captured `onresult` handler with both true mishearings
  (matches) and unrelated "hey ..." phrases like "hey Travis" (correctly doesn't match).
  Whatever it actually heard is shown on screen ("Heard: ...") so a miss is diagnosable instead
  of silent.
- Fixed a real bug found via live Chrome testing: React 18 StrictMode's dev-mode double-effect
  invocation (mount → cleanup → mount) left a shared "paused" ref stuck `true` after the
  cleanup from the discarded first mount ran — silently disabling the auto-restart that
  `continuous` mode needs after Chrome's periodic internal stop/restart cycles. Looked exactly
  like "the mic just stops working after a while." Fixed by explicitly resetting the ref on
  every mount rather than trusting its default.
- This is voice-first Q&A, not the full FR-4 spec (SSE streaming + inline source chips) — that
  remains a text-based "Ask" screen for later.

### Drift rules D4–D8

All five follow the D1–D3 pattern: pure functions in `src/rules/`, one fixture file each in
`test/rules/` (true-positive, boundary, FP-trap, resolution — 20 fixtures total, 75 passing
project-wide). D4 and D6 use the same `link.confidence >= 0.8`, non-fuzzy linking gate as D1/D2;
D5's weighting (solo reviewer requests count 1.0, shared 0.5) uses the `isSoloRequest` field the
GitHub connector already normalizes.

**Caveats:**
- **D7 (Scope creep) needs a per-issue `addedToSprintAt` timestamp the Jira connector doesn't
  populate yet** — it requires parsing "Sprint" field changelog entries, not just the
  current-state sprint report B3 already pulls. Added as an optional field on `Issue`; fixtures
  set it directly, real data waits on that connector work. The spec's "or count, if the team
  doesn't estimate" fallback is also unimplemented — the `Sprint` model only carries
  `committedPoints`, not a committed *issue count* to compare against, so teams that don't use
  points get no D7 coverage yet.
- **D6 (Red-but-moving)'s "forward transition" is approximated.** Design invariant #4 (rules
  read `statusCategory`, never raw status strings) means the rule can't reconstruct a team's
  full workflow order from raw per-transition labels. It instead checks the issue's *current*
  category is `in_progress` or `done` (i.e. it didn't move backward to blocked/other) and that
  the last transition happened after the CI failure started — same category + `lastTransitionAt`
  pattern D1/D2 already use, not a true step-by-step workflow walk.
- **D8 (Stale board) reuses D2's zombie check to honor "dedupe: D2 wins"** without rules calling
  rules (design invariant #1) — `isZombieInProgress` was pulled out of `d2.ts` as a shared
  predicate both rules import, rather than D8 invoking the D2 rule function directly. D8 also
  uses `lastTouchedAt` (Jira's `updated` field, which moves on comments) instead of D2's
  transition-only signal — closer to the spec's "no transition, comment, or linked commit," and
  incidentally closes the comment-tracking gap D2's own caveat documents, for D8 specifically.

### Finding lifecycle (B25)

`persistFindings` (`src/db/findings.ts`, called from `npm run drift`) already implemented the
open→corrected half of the lifecycle as a side effect of earlier query-service work — it just
wasn't tracked as its own backlog item until now. Each drift run upserts fresh findings as `open`
(one row per `team_id` + `dedupe_key`), and flips any previously-open finding the current rule
output no longer reproduces to `corrected`, stamping `resolved_at` and preserving the original
`detected_at`. Verified live against the demo fixture: `npm run drift` (4 open, including
`D1:NOVA-129`) → `ASOF_DEMO_PHASE=2 npm run sync` (PR #84 merges) → `npm run drift` again —
`D1:NOVA-129` flips to `corrected`, and `npm run brief` correctly narrates it under
"Since yesterday · ✓ Resolved". `ignored` and `snoozed` are now set by B35, below.

### Feedback actions & suppression (B35)

`POST /api/findings/:id/feedback` with `{"action": "correct" | "ignore" | "snooze"}` records a
`feedback` row and, per action: **ignore** sets the finding to `ignored` and writes a permanent
`suppression` row scoped to that exact `dedupe_key`, so the next drift run never reopens it —
`persistFindings` checks active suppressions before inserting any fresh `open` finding. **snooze**
sets `finding.status = 'snoozed'` with a `snoozed_until` 3 days out; `persistFindings` skips
reopening it until that passes, then reopens the *same row* in place (preserving `detected_at`)
rather than duplicating. **correct** only logs feedback — the finding stays open until the real
condition clears via auto-resolve, matching FR-7's "no fabricated confidence" spirit for
low-signal actions. The Today screen's `FindingCard` exposes all three; ignore/snooze remove the
card from view immediately (via `onResolved`), correct shows "✓ Marked correct" in place.

Verified live end-to-end (curl + the actual browser UI, not just unit tests): snoozed a finding
→ confirmed `npm run drift` correctly excludes it from the printed open count → ignored another
→ confirmed a `suppression` row was created and the finding never reopens across a fresh drift
run → clicked "Intentional, ignore" in the running web app and watched the card disappear live,
matching the DB. Along the way, fixed a real bug this surfaced: `drift.ts`'s console output was
printing the raw in-memory rule computation rather than what `persistFindings` actually left
open in the DB — harmless before B35 (they were always identical), silently wrong after, since a
suppressed finding the rules still produce is no longer actually open. It now re-queries
`getRankedOpenFindings` after persisting and prints that instead.

**Not done:** broader pattern-level suppression (e.g. "ignore D1 for `issueType = chore`" from
the design spec's FR-7 example) — every suppression here is scoped to one exact `dedupe_key`,
the finest grain. A management UI for reviewing/removing standing suppressions is B34 (Settings)
territory, not built.

### First live run against a real team (B14)

Connected to a real Jira Cloud site and a real GitHub repo for the first time and ran
`sync → drift → brief` end to end. This is real progress toward the B14 GO/NO-GO gate, but not
the gate itself — that still needs your own judgment on whether the findings are useful, per
`asof-product-plan.md` §11.

**Three real bugs the live run surfaced, all fixed:**
- **Atlassian removed `/rest/api/3/search`** (the endpoint `fetchIssues` used) in favor of
  `/rest/api/3/search/jql`, which is cursor-paginated (`nextPageToken`/`isLast`) instead of
  `startAt`/`total`. Migrated `src/connectors/jira.ts` accordingly.
- **`fetchActiveSprint` threw on Kanban boards.** Team-managed Jira projects default to Kanban,
  which has no sprints — Jira's API 400s with "The board does not support sprints" rather than
  returning an empty list. Now caught and treated as `sprint = null`, a legitimate case (D7/D8
  simply have nothing to evaluate on a Kanban team, same as they would on a quiet Scrum sprint).
- **The brief prompt leaked a literal placeholder.** The STRUCTURE section's example subhead,
  `"Sprint day X of Y · Z of T points remaining"`, had no fallback instruction for when
  `sprint` is `null` — the local model echoed the placeholder text verbatim instead of omitting
  it. Fixed with an explicit null-sprint instruction in `src/llm/brief.ts`.

**One real data-quality gap, not a bug:** issues seeded via Jira's CSV importer (rather than
moved through the UI/API) have no changelog entry for their current status — Jira never recorded
a transition into it. D1 and D2 both key off `issue.lastTransitionAt`, so CSV-imported issues
sitting in Done or In Progress are invisible to those rules until a real transition happens.
Confirmed by transitioning issues via the Jira API directly (`KAN-15` → In Progress, `KAN-16` →
Done) alongside a real unmerged PR — D1 and D2 both fired correctly once real transition history
existed.

**Verified findings, all against real data:** D1 fired on an issue moved straight to Done via
the API while its linked PR (opened via the GitHub API, referencing the issue key in the branch
name) stayed unmerged. D2 fired on three issues left untouched in In Progress past the threshold
— including two transitions made independently by a second real team member, not by any test
script, which is exactly the kind of organic signal the gate is waiting to be judged on.

**Residual, documented, not chased further:** the local Ollama narrator still sometimes gets the
finding *count* in the subhead wrong (e.g. reported 5 when there were 4) even after an explicit
"count them, don't estimate" instruction — same category of local-model unreliability already
noted in the Jarvis caveats below. Not pursued further since Ollama is the dev/demo fallback,
not the production path (`ANTHROPIC_API_KEY` is); the entity-hallucination guard (invariant #2),
which is the invariant that actually matters, was never violated.

### Fuzzy linking (B19)

Last-resort linking pass for PRs no rule-based source (explicit/branch_name/commit_ref) matched
— `src/linking/fuzzy.ts`. Haiku is shown the PR's title/body plus the connected project's issue
titles and asked whether one plausibly matches on subject matter, discarding anything below 0.5
confidence and any key it doesn't actually recognize from the offered list (a hallucination
guard, same spirit as the brief narrator's entity guard). Always `linkSource: "fuzzy"` —
drift-rules-spec.md §0 already has D1/D2/D6 exclude fuzzy links from their linking gate
regardless of confidence, so a wrong guess here can never itself drive a High-severity finding.

Opt-in: `resolveLinksWithFuzzy` (used by `npm run sync`) only calls Haiku when
`ANTHROPIC_API_KEY` is set, and only for PRs nothing else already linked — `npm run sync` stays
free and synchronous-fast by default. 9 fixture tests against a mocked `FuzzyLinkerClient`, no
live API calls in CI.

## Design invariants

These are enforced, not aspirational:

1. **Rules are pure functions** `(TeamState, RuleConfig) => Finding[]`. No I/O, no LLM calls.
2. **The LLM cannot create findings.** It receives ranked findings and typed query results only.
3. **Every finding carries >= 1 evidence link.** The DB has a CHECK constraint on this.
4. **Rules read `statusCategory`, never raw status strings.** Mapping is per-team, set at onboarding.
5. **No per-person metrics table exists.** Violating the privacy stance requires a schema change, which is reviewable.
6. **Read-only everywhere.** We never write to Jira or GitHub. We never fetch file contents or diffs.

## Layout

```
migrations/     SQL schema
src/config/     env validation
src/db/         pool + migration runner + repository/findings/personState queries
src/connectors/ jira.ts, github.ts, http.ts (retry/rate-limit)
src/linking/    PR <-> issue resolution      (explicit, branch_name, commit_ref — fuzzy is P4)
src/rules/      D1-D8 + rule runner          (all 8 done — D4-D8 are B20-B24)
src/llm/        brief narrator + chat Q&A     (Claude + Ollama fallback — B13, B28)
src/cli/        prototype entrypoints        (sync, drift, brief)
src/api/        Fastify query service        (/api/today, /api/standup, /api/ask — B27, B28)
apps/web/       React/Vite/Tailwind frontend (Today, Standup, Jarvis — B31/B32/B28; Settings is P4)
test/fixtures/  fake Jira/GitHub payloads + demoTeam.ts (credential-free pipeline demo)
```
