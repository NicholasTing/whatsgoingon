# whatsgoingon

A personal status board for the services you rely on. Open it, choose providers and components, and keep an eye on incidents. No sign-in or provider credentials required.

![A board showing Databricks, Claude and Codex with daily status history](docs/preview.png)

## Try it

Use Node.js 24 or later.

```sh
git clone https://github.com/NicholasTing/whatsgoingon.git
cd whatsgoingon
npm ci
npm run dev
```

Open <http://localhost:4173>. Databricks (AWS) is on the default board. Select its name, choose a region such as **AP Southeast 2**, select **Only these results**, and save. Use **Add services** for Claude, Codex, or another provider.

The frontend reloads while you edit it. Restart the development server after changing backend files.

## What you can use

- Public provider status, component and region filters, incident updates, and scheduled maintenance.
- A searchable catalogue, plus custom Statuspage-compatible pages and public HTTPS endpoint checks. Endpoint checks include response time, optional expected text, and TLS certificate expiry.
- Boards saved in your browser, groups, import/export, share links, and iframe embeds. Shared boards use fresh public data; each recipient controls their own copy.
- Daily observations and retained incident reports in SQLite. Missing history stays unknown.
- Browser alerts while the page is open. Your own running instance can send background alerts through generic webhooks, Slack, Discord, Teams workflows, or PagerDuty.
- A read-only JSON API, incident RSS feed, and embeddable status badges.

## Data and credentials

Board configuration is stored in local browser storage. Share links contain the board name, selected services and components, groups, and custom monitor URLs. They are configuration snapshots, not private or collaboratively edited workspaces.

The server fetches public status pages and stores public observations in `.data/status.sqlite`. Custom monitor URLs and expected text are sent to the server so it can perform the check. Use public targets only. There are no analytics, required API keys, or credentials bundled with the app.

Webhook settings entered in **API & alerts** are kept in that dialog until downloaded. They are not sent to the hosted server or saved in the board. To run background alerts, download `watch.config.json` and use it on your own instance:

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

It exposes port 4173 and keeps observations in a named volume. To enable alerts, mount your own `watch.config.json` read-only and set `WATCH_CONFIG` to its container path. Do not bake that file into an image.

For a deployment you want to keep, run one continuously available instance with a persistent disk and backups stored on another system. See [persistence and recovery](docs/persistence.md) for volume reuse, browser board exports, storage choices, and backup and restore steps.

## API

Examples below use the default local server. Add repeated `component` parameters to scope a provider's status or history.

```text
GET /api/catalog?q=databricks
GET /api/status/databricks
GET /api/history/databricks
GET /api/incidents?providers=databricks,claude,codex
GET /api/feed.xml?providers=databricks,claude,codex
GET /api/badge/databricks.svg
GET /api/health
```

The status response includes component IDs, current state, incident updates, observation timestamps, and stale-data warnings. The history response contains recorded checks and provider reports; it is not an uptime SLA measurement. Unknown or stale feeds do not become healthy by default.

The UI generates custom monitor URLs and configuration exports. Custom endpoints must use public HTTPS without embedded credentials, query strings, fragments, or a nonstandard port. The server validates DNS answers, pins the destination address, blocks private networks, does not follow redirects, and limits response sizes and request rates.

## Checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Unit tests cover feed normalization, component scope, stale data, history gaps, public URL validation, configuration sharing, and webhook retries. Browser tests cover the Databricks flow, board isolation, keyboard navigation, mobile layout, automated accessibility, and credential handling. Browser tests use deterministic provider responses; live provider checks should also be performed when changing an adapter.

## Limits

Public provider reports can lag failures and cannot establish the health of a specific account. Databricks' built-in feed covers AWS. Its current feed does not provide a complete resolved-incident archive, so this app accumulates observations as it runs. Other providers expose differing amounts of historical data.

Browser alerts depend on browser support and an open page. Background alerts require your own running instance and notification destination. Endpoint checks run from that instance, not a global probe network. RSS includes catalogue providers and is provider-wide.

Licensed under [MIT](LICENSE).
