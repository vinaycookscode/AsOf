import { useEffect, useState } from "react";
import { fetchToday } from "../api";
import type { TodayResponse } from "../types";
import { FindingCard } from "../components/FindingCard";
import { Chip } from "../components/Chip";

export function Today() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchToday()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="px-6 py-8 text-[var(--severity-high)]">Failed to load: {error}</p>;
  if (!data) return <p className="px-6 py-8 text-[var(--text-muted)]">Loading…</p>;

  const { sprint, sinceYesterday, latestBrief, teamName } = data;
  const findings = data.findings.filter((f) => !resolvedIds.has(f.id));

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
      <header>
        <h1 className="text-2xl">☀️ AsOf brief — {teamName}</h1>
        {sprint && (
          <p className="text-[var(--text-muted)]">
            Sprint day {sprint.dayOfSprint} of {sprint.totalDays} · {sprint.pointsRemaining} of {sprint.totalPoints} points
            remaining · {findings.length} finding{findings.length === 1 ? "" : "s"} need eyes
          </p>
        )}
      </header>

      {latestBrief && (
        <section className="rounded border border-[var(--border)] bg-[var(--bg-raised)] p-4">
          <h2 className="mb-2 text-base text-[var(--text-muted)]">Latest narrated brief</h2>
          <pre className="m-0 whitespace-pre-wrap font-sans text-[var(--text)]">{latestBrief.content}</pre>
        </section>
      )}

      <section>
        <h2 className="text-base text-[var(--text-muted)]">Needs a decision today</h2>
        {findings.length === 0 ? (
          <p>Board and repo agree this morning — nothing needs a decision.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {findings.map((f) => (
              <FindingCard
                key={f.dedupeKey}
                finding={f}
                onResolved={(id) => setResolvedIds((prev) => new Set(prev).add(id))}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-base text-[var(--text-muted)]">Since yesterday</h2>
        <div className="mt-2 space-y-3 text-sm">
          {sinceYesterday.resolvedFindings.map((r) => (
            <p key={`${r.ruleId}-${r.entityKey}`}>
              ✓ Resolved: <Chip label={r.entityKey} /> — {r.resolutionNote}
            </p>
          ))}
          {sinceYesterday.merged.length > 0 && (
            <p>
              Merged:{" "}
              {sinceYesterday.merged.map((m, i) => (
                <span key={m.prNumber}>
                  {i > 0 && ", "}
                  <Chip label={`PR #${m.prNumber}`} /> ({m.title})
                </span>
              ))}
            </p>
          )}
          {sinceYesterday.movedIssues.length > 0 && (
            <p>
              Moved:{" "}
              {sinceYesterday.movedIssues.map((m, i) => (
                <span key={m.issueKey}>
                  {i > 0 && ", "}
                  <Chip label={m.issueKey} /> → {m.toStatus}
                </span>
              ))}
            </p>
          )}
          {sinceYesterday.merged.length === 0 &&
            sinceYesterday.movedIssues.length === 0 &&
            sinceYesterday.resolvedFindings.length === 0 && <p className="text-[var(--text-muted)]">No movement recorded.</p>}
        </div>
      </section>
    </div>
  );
}
