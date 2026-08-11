interface ChipProps {
  label: string;
  href?: string;
}

/** Monospace entity chip — design-spec.md §2.5. Every claim needs one; a chip with no evidence link just isn't clickable. */
export function Chip({ label, href }: ChipProps) {
  const className = "chip inline-block rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[13px] text-[var(--text)] no-underline hover:border-[var(--accent)] hover:text-[var(--accent)]";

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {label}
      </a>
    );
  }
  return <span className={className}>{label}</span>;
}
