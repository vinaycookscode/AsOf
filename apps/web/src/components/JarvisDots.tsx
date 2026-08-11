import { useEffect, useRef } from "react";

export type JarvisStatus =
  | "connecting"
  | "wake-listening"
  | "acknowledging"
  | "question-listening"
  | "thinking"
  | "speaking"
  | "unsupported"
  | "mic-denied";

const LABEL: Record<JarvisStatus, string> = {
  connecting: "Starting up…",
  "wake-listening": 'Say "Hey Jarvis" to ask something',
  acknowledging: "Mm-hm…",
  "question-listening": "Listening for your question…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  unsupported: "Voice not supported in this browser",
  "mic-denied": "Microphone access denied",
};

const DOT_COUNT = 10_000;
// Must match index.css: --accent (#3b82f6) and --severity-high (#ef4444). Hardcoded so the
// render loop never has to read computed CSS custom properties on every frame.
const ACCENT_RGB = "59, 130, 246";
const SEVERITY_HIGH_RGB = "239, 68, 68";

/** Higher = calmer/slower blink; lower = faster/livelier. Keeps the field legible as a status signal. */
function speedMultiplier(status: JarvisStatus): number {
  switch (status) {
    case "thinking":
      return 0.45;
    case "speaking":
    case "acknowledging":
      return 0.6;
    case "question-listening":
      return 0.8;
    case "unsupported":
    case "mic-denied":
      return 1.6;
    default:
      return 1;
  }
}

interface Dot {
  x: number; // 0-1, fraction of width
  y: number; // 0-1, fraction of height
  r: number; // base radius, px
  period: number; // seconds per blink cycle at multiplier 1
  phase: number; // radians, so dots don't all blink in lockstep
}

/**
 * Full-screen ambient field (design-spec.md §2.5 — adapted, not copied, from the reference
 * Jarvis HUD): thousands of dots in the single accent color, each blinking on its own cycle.
 * Canvas + rAF, not DOM nodes — at this density (10k), individually-animated <span>s would
 * cost real layout/paint jank; a single per-frame draw call doesn't.
 */
export function JarvisDots({ status }: { status: JarvisStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    dotsRef.current = Array.from({ length: DOT_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1,
      period: 1.8 + Math.random() * 2.6,
      phase: Math.random() * Math.PI * 2,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const s = statusRef.current;
      const isError = s === "unsupported" || s === "mic-denied";
      const rgb = isError ? SEVERITY_HIGH_RGB : ACCENT_RGB;
      const mult = speedMultiplier(s);

      ctx.clearRect(0, 0, width, height);

      for (const d of dotsRef.current) {
        const cycle = (t / (d.period * mult)) * Math.PI * 2 + d.phase;
        const wave = 0.5 + 0.5 * Math.sin(cycle);
        ctx.globalAlpha = 0.12 + 0.6 * wave;
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(d.x * width, d.y * height, d.r * (0.8 + 0.4 * wave), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />
      <p className="relative text-sm text-[var(--text-muted)]">{LABEL[status]}</p>
    </>
  );
}
