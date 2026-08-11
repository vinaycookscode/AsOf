import type { Issue, Sprint } from "../connectors/types.js";
import { businessDaysSince } from "./businessDays.js";
import type { SprintClock } from "./types.js";

function subtractOneDay(date: Date): Date {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

/** "Sprint day X of Y" — design-spec.md §1: every finding needs this context. Pure function of sprint + issues + now. */
export function computeSprintClock(sprint: Sprint, issues: Issue[], now: Date): SprintClock {
  const startAt = sprint.startAt ? new Date(sprint.startAt) : now;
  const endAt = sprint.endAt ? new Date(sprint.endAt) : now;

  const dayOfSprint = Math.max(1, businessDaysSince(subtractOneDay(startAt), now));
  const totalDays = Math.max(dayOfSprint, businessDaysSince(subtractOneDay(startAt), endAt));

  const sprintIssues = issues.filter((i) => i.sprintId === sprint.id);
  const pointsRemaining = sprintIssues
    .filter((i) => i.statusCategory !== "done")
    .reduce((sum, i) => sum + (i.points ?? 0), 0);

  return { dayOfSprint, totalDays, pointsRemaining, totalPoints: sprint.committedPoints };
}
