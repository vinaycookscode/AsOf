import { useEffect, useState } from "react";
import { fetchStandup } from "../api";
import type { PersonState, PersonStateItem, StandupResponse } from "../types";
import { Chip } from "../components/Chip";
import { SeverityMarker } from "../components/SeverityMarker";

function ItemList({ items, emptyLabel }: { items: PersonStateItem[]; emptyLabel: string }) {
  if (items.length === 0) return <p className="text-sm text-[var(--text-muted)]">{emptyLabel}</p>;
  return (
    <ul className="m-0 list-none space-y-1 p-0 text-sm">
      {items.map((item, i) => (
        <li key={i}>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-[var(--text)] no-underline hover:text-[var(--accent)]">
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function PersonRow({ person }: { person: PersonState }) {
  return (
    <div className="grid grid-cols-[160px_1fr_1fr_1fr] gap-4 border-b border-[var(--border)] py-4">
      <div className="font-medium text-[var(--text-heading)]">{person.displayName}</div>
      <ItemList items={person.shipped} emptyLabel="Nothing shipped" />
      <ItemList items={person.inFlight} emptyLabel="Nothing in flight" />
      <div>
        {person.flags.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No flags</p>
        ) : (
          <ul className="m-0 list-none space-y-1 p-0 text-sm">
            {person.flags.map((f, i) => (
              <li key={i}>
                <SeverityMarker severity={f.severity} /> <Chip label={f.ruleId} /> {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Standup() {
  const [data, setData] = useState<StandupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStandup()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="px-6 py-8 text-[var(--severity-high)]">Failed to load: {error}</p>;
  if (!data) return <p className="px-6 py-8 text-[var(--text-muted)]">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl">Standup — {data.teamName}</h1>
      <div className="mt-4">
        <div className="grid grid-cols-[160px_1fr_1fr_1fr] gap-4 border-b border-[var(--border)] pb-2 text-sm font-medium text-[var(--text-muted)]">
          <div>Person</div>
          <div>Shipped</div>
          <div>In flight</div>
          <div>Flags</div>
        </div>
        {data.people.map((p) => (
          <PersonRow key={p.personId} person={p} />
        ))}
      </div>
    </div>
  );
}
