/**
 * Shared trust-boundary enforcement (README invariant #2): whatever narrates or answers,
 * every entity it names must trace back to data we actually gave it. Used by both the brief
 * narrator (brief.ts) and chat Q&A (ask.ts) — same rule, same regex, one place to fix it.
 */

export function findEntityMentions(text: string): string[] {
  const issueKeys = [...text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => m[0]);
  const prRefs = [...text.matchAll(/PR #\d+/g)].map((m) => m[0]);
  return [...issueKeys, ...prRefs];
}

export function findUngroundedMentions(text: string, allowed: Set<string>): string[] {
  return findEntityMentions(text).filter((mention) => !allowed.has(mention));
}
