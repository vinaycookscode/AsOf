import type { Severity } from "../types";

const MARKER: Record<Severity, string> = { high: "●", medium: "○", low: "·" };
const COLOR: Record<Severity, string> = {
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
};

/** ● high / ○ medium / · low — no alarm badges, per design-spec.md §2.5 and drift-rules-spec.md §1. */
export function SeverityMarker({ severity }: { severity: Severity }) {
  return (
    <span style={{ color: COLOR[severity] }} aria-label={severity}>
      {MARKER[severity]}
    </span>
  );
}

export function severityBorderColor(severity: Severity): string {
  return COLOR[severity];
}
