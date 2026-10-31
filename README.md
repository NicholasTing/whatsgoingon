# whatsgoingon

A read-only status board for the services you rely on. Configure a service array on the server, then view live status, history, and incidents. Everyone sees the same services. No sign-in or provider credentials required.

![Dark dashboard showing Databricks, Claude and Codex with unknown history (test data)](docs/preview.png)

## Try it

Use Node.js 24 or later.

```sh
git clone https://github.com/NicholasTing/whatsgoingon.git
cd whatsgoingon
npm ci
npm run dev
```

Open <http://localhost:4173>. Databricks (AWS) is configured by default. Select its name to open the official status page. Select its status or a history day to inspect incident reports.

The frontend reloads while you edit it. Restart the server after changing services.json or backend files.

## Configure services

Edit `services.json` before starting the server. It is an array of service IDs with optional component selections and groups:

```json
[
  { "id": "databricks", "componentIds": [], "group": "Data" },
  { "id": "claude", "group": "AI" },
  { "id": "codex", "group": "AI" }
]
```

IDs map to official status-page URLs and feed adapters in the static dictionary, [`server/catalog.ts`](server/catalog.ts). Available IDs are `databricks`, `claude`, `codex`, `openai`, `github`, `cloudflare`, `tailscale`, `modal`, `circleci`, `vercel`, `supabase`, `npm`, `pypi`, `docker`, `linear`, `notion`, and `discord`.

An empty or omitted `componentIds` selects all components. To scope a service, start with all components, inspect its `/api/status/<id>` response, copy the desired component IDs into the array, and restart. `group` is optional. The array permits up to 40 distinct IDs; invalid configuration stops startup. An empty array displays an empty board.

**To add, remove, or change a service, edit the file, restart the server, and reload the page.** A browser refresh alone does not reload the configuration. For `npm run dev` or `npm start`, stop the process with Ctrl+C and run the same command again. No rebuild is needed for service-array edits. For Compose, run `docker compose restart app` after editing the mounted file.

Use a different file with `SERVICES_CONFIG=/absolute/path/services.local.json npm start`. The app does not automatically load `.env` files. Appearance and the optional board name remain source configuration in `shared/appearance.ts` and `shared/board.ts`; rebuild and restart after changing them.

The browser cannot add services, edit component selections, import a board, or save appearance changes. Old browser boards and `#board=` links no longer control the dashboard; their stored data is left intact. Share links and embeds point to this server's configured board.

Service configuration needs no database. If you want runtime editing, you must implement and maintain your own database and authenticated editing API. That integration is not included. The existing SQLite database records status history and alert deliveries, not the service list.

For a public custom status page or endpoint, configure the monitor in the same array:

```json
[
  {
    "id": "my-api",
    "custom": {
      "name": "My API",
      "url": "https://example.com/health",
      "kind": "http"
    }
  }
]
```

Use `kind: "statuspage"` for a Statuspage-compatible page, or `kind: "http"` for a public HTTPS health endpoint. HTTP checks optionally accept `keyword` inside `custom` for expected response text. Add providers with other feed formats to the dictionary and implement their adapter. Custom URLs are public dashboard configuration; do not put credentials or private targets in them.

## Set up your organisation's page

Select **Set up your own** in the footer, optionally enter a page name, and choose a local preview or Docker setup. Copy the prompt into a coding-agent session opened in **your organisation's repository**. The agent audits application code, manifests, infrastructure, CI, and tool configuration before setting up the dashboard.

The audit produces an inventory with file-and-line evidence, confidence, product/region scope, and proposed monitors. It includes Claude and Codex as setup defaults. Review the list with the agent, resolve uncertain scopes, and add or remove services. Your current board is a starting point; the final board also includes the agreed audit findings. Unsupported or private services remain visible as gaps.

The agent then configures and starts the dashboard in a separate directory. It writes the agreed services.json array, validates it, and starts the read-only board for all visitors. It monitors the dependencies it finds; it does not provision the organisation's infrastructure.

You can also copy the [standalone setup prompt](docs/setup-prompt.md) and append your board JSON or hosting preferences. Without a starting board, it uses the audit findings, Claude, Codex, and a local preview. The agent needs access to both the organisation codebase and this repository; private repositories require GitHub access.

Review custom monitor URLs before sharing the prompt. Keep credentials in your own environment. The prompt prepares an agent task; it does not run or deploy the app from your browser.

## What you can use

- Live public provider status, configured component and region scope, incident updates, and scheduled maintenance.
- Search across configured services, with official status-page links, custom Statuspage-compatible pages, and public HTTPS endpoint checks. Endpoint checks include response time, optional expected text, and TLS certificate expiry.
- Server-configured groups, share links, and iframe embeds. Every visitor uses the same configured services.
- Dark appearance by default, with source-configured colours validated for contrast.
- The incident filter follows the board theme. Open it, then Tab to the selected option and use arrow keys to switch reports; Enter or Escape closes it.
- Daily observations and retained incident reports in SQLite. Select a history day (click, or arrow keys then Enter/Space) or current status to inspect related reports and open the official incident. Reports follow your selected components and UTC dates. Missing reports and history remain explicit.
- Background alerts configured by the server owner through generic webhooks, Slack, Discord, Teams workflows, or PagerDuty.
- A read-only JSON API, incident RSS feed, and embeddable status badges.

## Data and credentials

The service array is read once at startup. The browser reads configuration through `/api/board`; it does not persist or modify it. Status, history, incident, RSS, and badge endpoints accept only services configured on this server and use their fixed component selections.

The server fetches public status pages and stores public observations in `.data/status.sqlite`. Custom monitor URLs and expected text come from the server configuration. Use public targets only. There are no analytics, required API keys, or credentials bundled with the app.

## Background alerts

The server owner can create a private `watch.config.json` with monitors and destinations:

```json
{
  "monitors": [{ "id": "databricks", "componentIds": [], "group": "" }],
  "alertLevel": "all",
  "destinations": [{ "type": "webhook", "url": "https://example.com/your-webhook" }]
}
```

Use your actual destination URL. This separate file controls background alerts; it does not change the public board's service array. Start your instance with:

```sh
npm run build
WATCH_CONFIG=./watch.config.json npm start
```

Keep this file private: webhook URLs and routing keys can contain credentials. The filename, `.env` files, and `.data/` are ignored by Git. The collector stores pending deliveries locally, including their destinations. Protect and back up the data directory as you would the configuration file.

The collector establishes a baseline on startup, then sends changes. It retries failed deliveries with backoff. Delivery is at least once: receivers should deduplicate using the `X-Whatsgoingon-Event-Id` header. Failed deliveries remain in SQLite after their retry budget is exhausted. Restarting with the same data directory preserves history, baselines, and pending deliveries.

For Slack, Discord, and Teams, use your own incoming webhook URL. For PagerDuty, use the Events API endpoint and your integration's routing key. Generic webhooks can connect other notification systems without adding their credentials to this repository.

## Run a server

```sh
npm ci
npm run build
HOST=0.0.0.0 PORT=4173 npm start
```

Use an HTTPS reverse proxy for a public deployment. Mount a persistent volume at the directory selected by `DATA_DIR` (default `.data`). The app works with no authentication because the server API is read-only and serves public status data. It is not a place to store private endpoints or customer account information.

A Docker setup is included:

```sh
docker compose up --build -d
```

It exposes port 4173, mounts services.json read-only, and keeps observations in a named volume. To enable alerts, mount your own `watch.config.json` read-only and set `WATCH_CONFIG` to its container path. Do not bake that file into an image.

For a deployment you want to keep, run one continuously available instance with a persistent disk and backups stored on another system. See [persistence and recovery](docs/persistence.md) for volume reuse, service configuration, storage choices, and backup and restore steps.

`npm run build` produces the browser assets. A static deployment, including Vercel’s Vite preset, also needs the Node backend: route `/api/*` to an instance with persistent storage. Otherwise, provider requests return a missing-page response and the board reports that the status service is unavailable. Running the backend as serverless functions requires external persistence and scheduled collection; a temporary SQLite file will lose history when the instance is replaced.

## API

Examples below use the default local server. Component scope comes from services.json; request parameters cannot change it. The catalogue lists only configured services. Incident and RSS requests default to every configured service; an optional `providers` parameter can narrow that list.

```text
GET /api/board
GET /api/catalog?q=databricks
GET /api/status/databricks
GET /api/history/databricks
GET /api/incidents
GET /api/feed.xml
GET /api/badge/databricks.svg
GET /api/health
```

The status response includes component IDs, current state, incident updates, observation timestamps, and stale-data warnings. Each history day separates local check counts (`samples`) from matching provider report counts (`reports`). A reported incident can colour a day with no local checks. With neither checks nor reports, the day stays unknown; partial local coverage is never proof of all-day health. This is not an uptime SLA measurement. Unknown or stale feeds do not become healthy by default.

Custom endpoints must use public HTTPS without embedded credentials, query strings, fragments, or a nonstandard port. The server validates DNS answers, pins the destination address, blocks private networks, does not follow redirects, and limits response sizes and request rates.

## Checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Unit tests cover feed normalization, component scope, stale data, history gaps, public URL validation, startup configuration, restart behavior, read-only API enforcement, and webhook retries. Browser tests cover configured service links and logos, ignored legacy boards, incident reports, keyboard navigation, mobile layout, and automated accessibility. Browser tests use deterministic provider responses; live provider checks should also be performed when changing an adapter.

CI runs these checks on pushes and pull requests, plus `npm audit --audit-level=high` for known dependency vulnerabilities. Dependabot proposes weekly npm and GitHub Actions updates. Major npm updates remain separate for review.

The CodeQL workflow scans JavaScript and TypeScript on public repositories and skips private repositories. It also runs weekly and supports manual runs. See [GitHub's code scanning availability](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning). Standard GitHub-hosted runners are [free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions); private repositories use the owner's included allowance.

Pull requests receive automated reviews from [CodeRabbit](https://www.coderabbit.ai), configured in `.coderabbit.yaml`. It is free for public repositories and is not bundled with the app or required by CI. Forks need their own installation if they want it.

## Feedback

Use **Request a feature** or **Report a bug** in the footer to open the matching GitHub issue form. You can also [browse existing issues](https://github.com/NicholasTing/whatsgoingon/issues). Submitting an issue requires a GitHub account and access to the repository; a private repository cannot accept reports from the general public.

The forms are configured in `.github/ISSUE_TEMPLATE/` and apply the `bug` or `enhancement` label. GitHub Discussions can be enabled separately for broader conversations; issue forms cover the feedback flow here. If you fork the project, change `GITHUB` in `src/App.tsx` to direct feedback to your repository.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and the pull request process, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Limits

Public provider reports can lag failures and cannot establish the health of a specific account. Databricks' built-in feed covers AWS. Its current feed does not provide a complete resolved-incident archive, so this app accumulates observations as it runs. Other providers expose differing amounts of historical data.

Background alerts require your own running instance and notification destination. Endpoint checks run from that instance, not a global probe network. RSS includes configured services and follows their component selections.

Licensed under [MIT](LICENSE).
