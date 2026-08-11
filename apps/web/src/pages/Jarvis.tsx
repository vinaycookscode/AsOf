import { useCallback, useEffect, useRef, useState } from "react";
import { JarvisDots, type JarvisStatus } from "../components/JarvisDots";

interface AskResponse {
  answer?: string;
  error?: string;
}

type Mode = "wake" | "question";

const WAKE_PHRASE_RE = /\bhey,?\s*jarvis\b[,.!]?\s*/i;
const HEY_WORD_RE = /\bhey,?\s+([a-z']+)\b[,.!]?\s*/i;
const FUZZY_MAX_DISTANCE = 2; // tolerates STT mishearing "Jarvis" (an uncommon proper noun) as e.g. "Jervis", "Charvis", "Garvis"
const QUESTION_TIMEOUT_MS = 10_000;
const ACK_PHRASE = "Mm-hm. What status are you looking for?";

function getRecognitionCtor(): (new () => SpeechRecognition) | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j - 1]!, dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

/** Exact "hey jarvis" first; falls back to "hey <word>" where <word> is close enough to "jarvis"
 *  to survive Chrome mishearing an unusual name (verified necessary — see README Jarvis caveats). */
function stripWakePhrase(text: string): { hasWake: boolean; remainder: string } {
  const exact = WAKE_PHRASE_RE.exec(text);
  if (exact) {
    return { hasWake: true, remainder: text.slice(exact.index + exact[0].length).trim() };
  }

  const heyWord = HEY_WORD_RE.exec(text);
  if (heyWord && levenshtein(heyWord[1]!.toLowerCase(), "jarvis") <= FUZZY_MAX_DISTANCE) {
    return { hasWake: true, remainder: text.slice(heyWord.index + heyWord[0].length).trim() };
  }

  return { hasWake: false, remainder: text };
}

export function Jarvis() {
  const [status, setStatus] = useState<JarvisStatus>("connecting");
  const [answer, setAnswer] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pausedRef = useRef(false); // true while deliberately not listening (acknowledging/thinking/speaking)
  const modeRef = useRef<Mode>("wake"); // wake = waiting for "Hey Jarvis"; question = next utterance is the question
  const questionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearQuestionTimeout = () => {
    if (questionTimeoutRef.current) {
      clearTimeout(questionTimeoutRef.current);
      questionTimeoutRef.current = null;
    }
  };

  const startListening = useCallback((nextStatus: JarvisStatus) => {
    pausedRef.current = false;
    setStatus(nextStatus);
    try {
      recognitionRef.current?.start();
    } catch {
      // already running — fine
    }
  }, []);

  const backToWake = useCallback(() => {
    clearQuestionTimeout();
    modeRef.current = "wake";
    startListening("wake-listening");
  }, [startListening]);

  const speak = useCallback((text: string, onDone: () => void) => {
    if (!("speechSynthesis" in window)) {
      onDone();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = onDone;
    utterance.onerror = onDone;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopListeningForSpeech = () => {
    pausedRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      // not running — fine
    }
  };

  const acknowledgeWake = useCallback(() => {
    stopListeningForSpeech();
    setStatus("acknowledging");
    speak(ACK_PHRASE, () => {
      modeRef.current = "question";
      startListening("question-listening");
      clearQuestionTimeout();
      questionTimeoutRef.current = setTimeout(() => {
        if (modeRef.current === "question") backToWake();
      }, QUESTION_TIMEOUT_MS);
    });
  }, [speak, startListening, backToWake]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) {
        backToWake();
        return;
      }

      clearQuestionTimeout();
      stopListeningForSpeech();
      setStatus("thinking");
      setErrorMessage(null);

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });
        const data = (await res.json()) as AskResponse;
        if (!res.ok || !data.answer) throw new Error(data.error ?? `Request failed: ${res.status}`);

        setAnswer(data.answer);
        setStatus("speaking");
        speak(data.answer, backToWake);
      } catch (err) {
        setErrorMessage((err as Error).message);
        backToWake();
      }
    },
    [speak, backToWake],
  );

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) final += result[0]!.transcript;
      }
      if (!final.trim()) return;

      if (modeRef.current === "wake") {
        const { hasWake, remainder } = stripWakePhrase(final);
        if (!hasWake) return; // not addressed to Jarvis — ignore, stay in wake-listening
        if (remainder.length > 2) {
          // "Hey Jarvis, how is Wei doing?" said in one breath — skip the prompt, answer directly.
          clearQuestionTimeout();
          void ask(remainder);
        } else {
          acknowledgeWake();
        }
      } else {
        void ask(final);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        pausedRef.current = true;
        setStatus("mic-denied");
      }
      // other errors (e.g. 'no-speech') are routine in continuous mode; onend below restarts.
    };

    recognition.onend = () => {
      if (!pausedRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore — already running
        }
      }
    };

    recognitionRef.current = recognition;
    // Reset explicitly: in React 18 StrictMode dev double-invocation (mount -> cleanup -> mount),
    // the discarded first effect's cleanup sets this shared ref true; without resetting it here,
    // the surviving instance's onend-restart logic stays permanently gated off after mount.
    pausedRef.current = false;
    modeRef.current = "wake";
    try {
      recognition.start();
      setStatus("wake-listening");
    } catch {
      setStatus("mic-denied");
    }

    return () => {
      pausedRef.current = true;
      clearQuestionTimeout();
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      window.speechSynthesis?.cancel();
    };
  }, [ask, acknowledgeWake]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("q") as HTMLInputElement;
    void ask(input.value); // typing is already an explicit action — no wake word needed
    input.value = "";
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-center">
      <JarvisDots status={status} />

      {status === "mic-denied" && (
        <p className="relative max-w-md text-sm text-[var(--severity-high)]">
          Microphone access was denied. Allow it in your browser's site settings to use voice, or type below.
        </p>
      )}
      {status === "unsupported" && (
        <p className="relative max-w-md text-sm text-[var(--severity-high)]">
          This browser doesn't support continuous speech recognition (works best in Chrome/Edge). Type below instead.
        </p>
      )}
      {errorMessage && <p className="relative text-sm text-[var(--severity-high)]">{errorMessage}</p>}
      {answer && (status === "speaking" || status === "wake-listening") && (
        <p className="relative max-w-lg px-6 text-[var(--text)]">{answer}</p>
      )}

      <form onSubmit={handleTextSubmit} className="absolute inset-x-0 bottom-10 mx-auto w-full max-w-md px-6">
        <input
          name="q"
          type="text"
          placeholder='Type a question, or say "Hey Jarvis"'
          className="w-full rounded-full border border-[var(--border)] bg-[var(--bg-raised)]/80 px-5 py-2.5 text-center text-sm text-[var(--text)] outline-none backdrop-blur focus:border-[var(--accent)]"
        />
      </form>
    </div>
  );
}
