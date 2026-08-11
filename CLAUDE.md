# AsOf — project memory

Read this first in every session. Full source specs live in `.claude/context/` (copied from
Downloads so the project doesn't depend on external files being present):

| File | What it's for |
|---|---|
| `.claude/context/asof-product-plan.md` | Thesis, personas, FR-1..FR-8/NFR-1..NFR-5, roadmap (P0-P3+), success metrics, risks |
| `.claude/context/asof-design-spec.md` | North-star brief (§1, the quality bar for all narration), UX flows, DB schema, architecture trust boundary |
| `.claude/context/asof-drift-rules-spec.md` | D1-D8 conditions, thresholds, templates, FP traps — the spec `src/rules/*.ts` implements |
| `.claude/context/asof-delivery-tracker.xlsx` | Phase/task/backlog tracker (Dashboard, Phases, Tasks, Dev Backlog sheets) |

## One-liner

Detects **drift** between what Jira claims and what GitHub actually shows, then narrates it.
Rules (`src/rules/`) find facts as pure functions; the LLM only writes sentences from ranked
findings — it can never invent one. See design invariants in [README.md](README.md).

## Where the live status actually lives

**[README.md](README.md)'s Status table is the current source of truth for what's done.**
`.claude/context/asof-delivery-tracker.xlsx` (Dev Backlog sheet, columns A=ID, H=Status,
I=Notes) is the fuller phase/task-level tracker — it should always agree with README.md.

**After finishing any unit of work, update both**, in the same pass:
1. `README.md` Status table (+ a caveats note if the work has a real scope gap or a non-obvious decision)
2. `.claude/context/asof-delivery-tracker.xlsx` — mark the relevant Dev Backlog row(s) Done/In
   Progress with a note, and if it closes out a Tasks-sheet row, update that too (openpyxl —
   the `xlsx` skill has the how-to; the Dashboard/summary cells are formulas, don't hand-edit them)

Do this from the copy in `.claude/context/`, not `~/Downloads` — that's now just the drop
location the files originally arrived from.

## Architecture quick reference

```
src/connectors/  Jira + GitHub clients, retry/rate-limit (B3-B5, done)
src/linking/     PR<->issue resolution: explicit, branch_name, commit_ref (B7-B8, done; fuzzy is P4/B19)
src/rules/       D1-D8 pure rule functions + runner (all 8 done — B10-B12, B20-B24)
src/llm/         brief narrator + chat Q&A tool-use loop (B13, B28, done)
src/api/         Fastify query service: /api/today, /api/standup, /api/ask (B27, B28, done)
src/cli/         sync / drift / brief entrypoints (B14, code done — GO/NO-GO gate blocked, see below)
apps/web/        Today, Standup, Jarvis screens (B31/B32/B28, done); Ask + Settings are P4, not started
test/rules/      fixture tests per rule: TP / boundary / FP-trap / resolution, 4 per rule minimum
```

Rule engine contract (binding, drift-rules-spec.md §0): `(TeamState, RuleConfig) => Finding[]`,
pure, no I/O, no LLM calls, every Finding has >= 1 evidence link. Rules never call other rules —
share logic via plain exported predicates (see `isZombieInProgress` in `src/rules/d2.ts`, reused
by `src/rules/d8.ts`).

## Known blockers / open gaps (don't re-discover these)

- **B14 GO/NO-GO gate (P3 exit) is blocked on having a real Jira project + GitHub repo and a
  lead's usefulness judgment.** The user has confirmed there is no real Jira project available —
  this gate cannot close yet. Don't propose "just connect real credentials" as a next step
  without checking whether that's changed.
- **D7 (Scope creep)** needs `Issue.addedToSprintAt`, which the Jira connector doesn't populate
  yet (needs Sprint-field changelog parsing, not just the current-state sprint report). Field
  exists on the type, fixtures set it directly. See README's "Drift rules D4-D8" caveats.
- **D6 "forward transition"** is approximated via current `statusCategory` + `lastTransitionAt`
  (invariant #4 forbids reasoning over raw per-transition status strings), not a true
  step-by-step workflow-order walk.
- Jarvis voice caveats (StrictMode double-effect bug, fuzzy wake-word matching, local-model
  language drift) are documented in README.md, not repeated here.

## Working conventions this project has settled on

- Every rule file: header comment naming the drift-rules-spec.md section, the condition in
  prose, and any scope gap vs. the spec — see `src/rules/d2.ts` or `d8.ts` for the pattern.
- Test fixtures follow the same 4-case shape per rule (true-positive, boundary, FP-trap,
  resolution) using `test/rules/helpers.ts` factories (`makeIssue`, `makePr`, `makeCommit`,
  `makeLink`, `makeCiRun`, `makeSprint`, `makeConfig`) — extend helpers rather than
  hand-constructing `TeamState` inline.
- `NOW` in tests is fixed to Thursday 2026-08-06T12:00Z (see helpers.ts) — pick fixture
  timestamps relative to that week, not `Date.now()`.
