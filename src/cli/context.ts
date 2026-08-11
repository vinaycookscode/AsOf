import { env } from "../config/env.js";

export function isLiveMode(): boolean {
  return Boolean(env.jira.baseUrl && env.jira.email && env.jira.apiToken && env.jira.projectKey && env.github.token);
}

export function resolveTeamName(demoTeamName: string): string {
  return isLiveMode() ? `${env.jira.projectKey} team` : demoTeamName;
}

/** DRIFT_NOW lets rule evaluation be pinned to a fixed instant for demo/debugging; unset in normal use. */
export function resolveNow(): Date {
  const override = process.env.DRIFT_NOW;
  return override ? new Date(override) : new Date();
}
