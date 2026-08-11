import type { Rule } from "./types.js";
import { d1DoneButNotMerged } from "./d1.js";
import { d2ZombieInProgress } from "./d2.js";
import { d3SilentPr } from "./d3.js";
import { d4OrphanWork } from "./d4.js";
import { d5ReviewOverload } from "./d5.js";
import { d6RedButMoving } from "./d6.js";
import { d7ScopeCreep } from "./d7.js";
import { d8StaleBoard } from "./d8.js";

export * from "./types.js";
export { runRules } from "./runner.js";
export { businessDaysSince } from "./businessDays.js";
export { computeSprintClock } from "./sprintClock.js";
export { d1DoneButNotMerged } from "./d1.js";
export { d2ZombieInProgress, isZombieInProgress } from "./d2.js";
export { d3SilentPr } from "./d3.js";
export { d4OrphanWork } from "./d4.js";
export { d5ReviewOverload } from "./d5.js";
export { d6RedButMoving } from "./d6.js";
export { d7ScopeCreep } from "./d7.js";
export { d8StaleBoard } from "./d8.js";

export const ALL_RULES: Rule[] = [
  d1DoneButNotMerged,
  d2ZombieInProgress,
  d3SilentPr,
  d4OrphanWork,
  d5ReviewOverload,
  d6RedButMoving,
  d7ScopeCreep,
  d8StaleBoard,
];
