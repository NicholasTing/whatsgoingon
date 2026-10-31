import type { Provider } from "../shared/types.ts";

function statuspage(
  id: string,
  name: string,
  category: string,
  statusUrl: string,
  componentPattern?: string,
): Provider {
  return {
    id,
    name,
    category,
    statusUrl,
    adapter: "statuspage",
    feed: `${statusUrl}/api/v2/summary.json`,
    componentPattern,
  };
}
export const providers: Provider[] = [
  {
    id: "databricks",
    name: "Databricks (AWS)",
    category: "Data & infrastructure",
    statusUrl: "https://status.databricks.com",
    adapter: "statusio",
    feed: "https://status.databricks.com/1.0/status/5cf02dde58a00904bda41926",
  },
  statuspage(
    "claude",
    "Claude",
    "AI & developer tools",
    "https://status.claude.com",
  ),
  statuspage(
    "codex",
    "Codex",
    "AI & developer tools",
    "https://status.openai.com",
    "^Codex(?: |$)",
  ),
  statuspage(
    "openai",
    "OpenAI",
    "AI & developer tools",
    "https://status.openai.com",
  ),
  statuspage(
    "github",
    "GitHub",
    "AI & developer tools",
    "https://www.githubstatus.com",
  ),
  statuspage(
    "cloudflare",
    "Cloudflare",
    "Data & infrastructure",
    "https://www.cloudflarestatus.com",
  ),
  statuspage(
    "tailscale",
    "Tailscale",
    "Data & infrastructure",
    "https://status.tailscale.com",
  ),
  {
    id: "modal",
    name: "Modal",
    category: "Data & infrastructure",
    statusUrl: "https://status.modal.com",
    adapter: "betterstack",
    feed: "https://status.modal.com/index.json",
  },
  statuspage(
    "circleci",
    "CircleCI",
    "AI & developer tools",
    "https://status.circleci.com",
  ),
  statuspage(
    "vercel",
    "Vercel",
    "Data & infrastructure",
    "https://www.vercel-status.com",
  ),
  statuspage(
    "supabase",
    "Supabase",
    "Data & infrastructure",
    "https://status.supabase.com",
  ),
  statuspage("npm", "npm", "AI & developer tools", "https://status.npmjs.org"),
  statuspage(
    "pypi",
    "PyPI",
    "AI & developer tools",
    "https://status.python.org",
    "pypi|pythonhosted",
  ),
  statuspage(
    "docker",
    "Docker",
    "AI & developer tools",
    "https://www.dockerstatus.com",
  ),
  statuspage("linear", "Linear", "Workplace", "https://linearstatus.com"),
  statuspage("notion", "Notion", "Workplace", "https://www.notion-status.com"),
  statuspage("discord", "Discord", "Workplace", "https://discordstatus.com"),
];
