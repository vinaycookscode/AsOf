/** Extracts Jira-style issue keys (e.g. NOVA-142), filtered to connected project keys
 *  only (drift-rules-spec.md D4 FP trap: don't link across another team's project). */
export function extractIssueKeys(text: string, projectKeys: string[]): string[] {
  const projectSet = new Set(projectKeys.map((k) => k.toUpperCase()));
  // Case-insensitive: branch names and commit messages are typically lowercase (nova-142-rate-limit).
  const matches = text.matchAll(/\b([A-Za-z][A-Za-z0-9]+)-(\d+)\b/g);
  const keys = new Set<string>();
  for (const match of matches) {
    const project = match[1]!.toUpperCase();
    if (projectSet.has(project)) keys.add(`${project}-${match[2]}`);
  }
  return [...keys];
}
