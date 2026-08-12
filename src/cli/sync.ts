import { isAnthropicConfigured, requireAnthropicConfig, requireGithubConfig, requireJiraConfig } from "../config/env.js";
import { GithubClient } from "../connectors/github.js";
import { JiraClient } from "../connectors/jira.js";
import type { Commit, Person, PullRequest } from "../connectors/types.js";
import { pool } from "../db/pool.js";
import { getOrCreateTeam, syncTeamState, type SyncBundle } from "../db/repository.js";
import { createHaikuLinker, resolveLinksWithFuzzy } from "../linking/index.js";
import { isLiveMode, resolveNow, resolveTeamName } from "./context.js";
import { buildDemoBundle, DEMO_PROJECT_KEYS, DEMO_TEAM_NAME } from "../../test/fixtures/demoTeam.js";

async function syncLive(): Promise<{ bundle: Omit<SyncBundle, "links">; projectKeys: string[] }> {
  const jiraConfig = requireJiraConfig();
  const githubConfig = requireGithubConfig();

  const jira = new JiraClient(jiraConfig);
  const [rawIssues, rawSprint] = await Promise.all([jira.fetchIssues(), jira.fetchActiveSprint()]);
  const { issues, people: jiraPeople, sprint } = jira.normalize(rawIssues, rawSprint);

  const github = new GithubClient(githubConfig);
  const people: Person[] = [...jiraPeople];
  const pullRequests: PullRequest[] = [];
  const commits: Commit[] = [];

  for (const repo of githubConfig.repos) {
    const { pullRequests: rawPrs, reviewsByPr, checkRunsByPr } = await github.fetchRepoData(repo);
    const rawCommits = await github.fetchCommits(repo);
    const normalized = github.normalize(repo, rawPrs, reviewsByPr, checkRunsByPr, rawCommits);
    people.push(...normalized.people);
    pullRequests.push(...normalized.pullRequests);
    commits.push(...normalized.commits);
  }

  return {
    bundle: { people, issues, pullRequests, commits, ciRuns: [], sprint },
    projectKeys: [jiraConfig.projectKey],
  };
}

async function main(): Promise<void> {
  const live = isLiveMode();
  const teamName = resolveTeamName(DEMO_TEAM_NAME);

  let base: Omit<SyncBundle, "links">;
  let projectKeys: string[];

  if (live) {
    console.log(`Live mode: pulling from Jira + GitHub for team "${teamName}"...`);
    const result = await syncLive();
    base = result.bundle;
    projectKeys = result.projectKeys;
  } else {
    console.log(
      `Jira/GitHub credentials not fully set in .env — seeding demo fixture data for "${teamName}" ` +
        `(see README Setup). Set JIRA_* and GITHUB_* to sync a real team.`,
    );
    const phase = process.env.ASOF_DEMO_PHASE === "2" ? 2 : 1;
    const demo = buildDemoBundle(resolveNow(), phase);
    base = { ...demo, ciRuns: [] };
    projectKeys = DEMO_PROJECT_KEYS;
  }

  // Fuzzy linking (B19) only when an Anthropic key is set — otherwise every unlinked PR would
  // silently no-op it, which is fine, but staying opt-in keeps `npm run sync` free by default.
  const linker = isAnthropicConfigured() ? createHaikuLinker(requireAnthropicConfig().apiKey) : undefined;
  const links = await resolveLinksWithFuzzy(base.pullRequests, base.commits, base.issues, projectKeys, linker);
  const bundle: SyncBundle = { ...base, links };

  const { teamId } = await getOrCreateTeam(teamName);
  await syncTeamState(teamId, bundle);

  console.log(
    `Synced: ${bundle.issues.length} issues, ${bundle.pullRequests.length} PRs, ${bundle.commits.length} commits, ` +
      `${bundle.links.length} links (${bundle.links.filter((l) => l.linkSource === "explicit").length} explicit, ` +
      `${bundle.links.filter((l) => l.linkSource === "branch_name").length} branch_name, ` +
      `${bundle.links.filter((l) => l.linkSource === "commit_ref").length} commit_ref, ` +
      `${bundle.links.filter((l) => l.linkSource === "fuzzy").length} fuzzy), ${bundle.people.length} people.`,
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
