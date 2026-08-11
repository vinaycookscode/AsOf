import { useState } from "react";
import type { EntityRef, Evidence, FeedbackAction, Finding } from "../types";
import { postFeedback } from "../api";
import { Chip } from "./Chip";
import { SeverityMarker, severityBorderColor } from "./SeverityMarker";

function chipLabel(ref: EntityRef): string | undefined {
  if (ref.issueKey) return ref.issueKey;
  if (ref.prNumber !== undefined) return `PR #${ref.prNumber}`;
  return undefined;
}

function chipHref(ref: EntityRef, evidence: Evidence[]): string | undefined {
  const needle = ref.issueKey ?? (ref.prNumber !== undefined ? `#${ref.prNumber}` : undefined);
  if (!needle) return undefined;
  return evidence.find((e) => e.label.includes(needle))?.sourceUrl;
}

const ACTION_LABEL: Record<FeedbackAction, string> = { correct: "Correct", ignore: "Intentional, ignore", snooze: "Snooze" };

/** One finding, evidence-first (design principle 1): every claim renders with a clickable source chip.
 *  Feedback actions (B35, FR-7): correct/ignore/snooze. Ignore and snooze remove the card from view
 *  (via onResolved) since the finding is no longer open; correct just acknowledges it in place. */
export function FindingCard({ finding, onResolved }: { finding: Finding; onResolved?: (findingId: string) => void }) {
  const [pending, setPending] = useState<FeedbackAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const act = async (action: FeedbackAction) => {
    setPending(action);
    setError(null);
    try {
      await postFeedback(finding.id, action);
      if (action === "correct") {
        setAcknowledged(true);
      } else {
        onResolved?.(finding.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="border-l-[3px] pl-4 py-2" style={{ borderLeftColor: severityBorderColor(finding.severity) }}>
      <p className="m-0 text-[var(--text-heading)]">
        <SeverityMarker severity={finding.severity} /> <span className="font-medium">{finding.message}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {finding.entityRefs.map((ref, i) => {
          const label = chipLabel(ref);
          if (!label) return null;
          return <Chip key={i} label={label} href={chipHref(ref, finding.evidence)} />;
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
        {acknowledged ? (
          <span>✓ Marked correct</span>
        ) : (
          (["correct", "ignore", "snooze"] as FeedbackAction[]).map((action) => (
            <button
              key={action}
              type="button"
              disabled={pending !== null}
              onClick={() => void act(action)}
              className="cursor-pointer border-0 bg-transparent p-0 text-[var(--text-muted)] underline decoration-dotted hover:text-[var(--accent)] disabled:cursor-wait disabled:opacity-50"
            >
              {pending === action ? "…" : ACTION_LABEL[action]}
            </button>
          ))
        )}
      </div>
      {error && <p className="mt-1 text-sm text-[var(--severity-high)]">{error}</p>}
    </div>
  );
}
