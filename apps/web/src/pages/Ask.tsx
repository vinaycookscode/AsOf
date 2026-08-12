import { useRef, useState } from "react";
import { postAsk } from "../api";
import { Chip } from "../components/Chip";

interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: Record<string, string>;
  error?: boolean;
}

const SUGGESTED_PROMPTS = ["who's blocked?", "what changed?", "sprint status?"];

/** Matches the same entity shapes the backend's groundingGuard.ts looks for — issue keys and PR refs. */
const ENTITY_RE = /\b[A-Z][A-Z0-9]+-\d+\b|PR #\d+/g;

/** Renders assistant prose with entity mentions swapped for chips (clickable when a source URL
 *  was collected for them, plain otherwise) — design principle 1, evidence or it didn't happen. */
function renderWithChips(text: string, sources: Record<string, string>) {
  const parts: (string | { entity: string })[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(ENTITY_RE)) {
    parts.push(text.slice(lastIndex, match.index));
    parts.push({ entity: match[0] });
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));

  return parts.map((part, i) =>
    typeof part === "string" ? (
      <span key={i}>{part}</span>
    ) : (
      <Chip key={i} label={part.entity} href={sources[part.entity]} />
    ),
  );
}

export function Ask() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setPending(true);
    try {
      const res = await postAsk(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", text: res.answer, sources: res.sources }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: (err as Error).message, error: true }]);
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = inputRef.current?.value ?? "";
    inputRef.current!.value = "";
    void ask(value);
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-8">
      <h1 className="text-2xl">Ask</h1>

      <div className="mt-6 flex-1 space-y-4 overflow-auto">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-[var(--text-muted)]">Ask anything about the team's current state.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void ask(prompt)}
                  className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <p
              className={
                "m-0 inline-block max-w-[85%] rounded px-3 py-2 text-left " +
                (m.role === "user"
                  ? "bg-[var(--accent)]/15 text-[var(--text)]"
                  : m.error
                    ? "text-[var(--severity-high)]"
                    : "bg-[var(--bg-raised)] text-[var(--text)]")
              }
            >
              {m.role === "assistant" && !m.error ? renderWithChips(m.text, m.sources ?? {}) : m.text}
            </p>
          </div>
        ))}

        {pending && <p className="text-[var(--text-muted)]">Thinking…</p>}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex shrink-0 gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask anything…"
          disabled={pending}
          className="flex-1 rounded-full border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2 text-sm text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-wait disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
