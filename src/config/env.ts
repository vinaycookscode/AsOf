import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),

  jira: {
    baseUrl: optional("JIRA_BASE_URL"),
    email: optional("JIRA_EMAIL"),
    apiToken: optional("JIRA_API_TOKEN"),
    projectKey: optional("JIRA_PROJECT_KEY"),
  },

  github: {
    token: optional("GITHUB_TOKEN"),
    owner: optional("GITHUB_OWNER"),
    repos: (optional("GITHUB_REPOS") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
  },

  anthropic: {
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: optional("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5",
  },

  /** Free local fallback for brief narration when no Anthropic key is set (dev/demo only — not the production LLM layer per product-plan §6). */
  ollama: {
    baseUrl: optional("OLLAMA_BASE_URL") ?? "http://localhost:11434",
    model: optional("OLLAMA_MODEL"),
  },
};

export function requireJiraConfig(): { baseUrl: string; email: string; apiToken: string; projectKey: string } {
  const { baseUrl, email, apiToken, projectKey } = env.jira;
  if (!baseUrl || !email || !apiToken || !projectKey) {
    throw new Error(
      "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY in .env",
    );
  }
  return { baseUrl, email, apiToken, projectKey };
}

export function requireGithubConfig(): { token: string; owner: string; repos: string[] } {
  const { token, owner, repos } = env.github;
  if (!token || !owner || repos.length === 0) {
    throw new Error("GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPOS in .env");
  }
  return { token, owner, repos };
}

export function requireAnthropicConfig(): { apiKey: string; model: string } {
  const { apiKey, model } = env.anthropic;
  if (!apiKey) {
    throw new Error("Anthropic is not configured. Set ANTHROPIC_API_KEY in .env");
  }
  return { apiKey, model };
}

export function isOllamaConfigured(): boolean {
  return Boolean(env.ollama.model);
}

export function requireOllamaConfig(): { baseUrl: string; model: string } {
  const { baseUrl, model } = env.ollama;
  if (!model) {
    throw new Error("Ollama is not configured. Set OLLAMA_MODEL in .env (e.g. llama3.1:8b)");
  }
  return { baseUrl, model };
}
