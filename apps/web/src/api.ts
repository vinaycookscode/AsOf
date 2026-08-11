import type { FeedbackAction, StandupResponse, TodayResponse } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchToday = (): Promise<TodayResponse> => getJson("/api/today");
export const fetchStandup = (): Promise<StandupResponse> => getJson("/api/standup");

export async function postFeedback(findingId: string, action: FeedbackAction): Promise<void> {
  const res = await fetch(`/api/findings/${findingId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`POST feedback failed: ${res.status}`);
}
