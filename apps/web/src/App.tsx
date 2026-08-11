import { useState } from "react";
import { Today } from "./pages/Today";
import { Standup } from "./pages/Standup";
import { Jarvis } from "./pages/Jarvis";

const SCREENS = {
  Today: Today,
  Standup: Standup,
  Jarvis: Jarvis,
} as const;
type Screen = keyof typeof SCREENS;

function App() {
  const [screen, setScreen] = useState<Screen>("Today");
  const ActiveScreen = SCREENS[screen];

  return (
    <div className="flex h-screen flex-col">
      <nav className="shrink-0 border-b border-[var(--border)] px-6 py-3">
        <div className="mx-auto flex max-w-4xl gap-4">
          {(Object.keys(SCREENS) as Screen[]).map((s) => (
            <button
              key={s}
              onClick={() => setScreen(s)}
              className={
                "border-none bg-transparent px-1 py-1 text-sm font-medium " +
                (screen === s ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              {s}
            </button>
          ))}
        </div>
      </nav>
      {/* No padding here — Jarvis needs the full bleed. Today/Standup add their own. */}
      <main className="relative flex-1 overflow-auto">
        <ActiveScreen />
      </main>
    </div>
  );
}

export default App;
