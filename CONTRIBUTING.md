# Contributing to whatsgoingon

Thanks for helping. Bug reports, provider additions, documentation fixes, and code changes are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are accepted under the project's [MIT License](LICENSE).

## Before you start

- **Bugs and ideas:** open an issue with the [bug report](https://github.com/NicholasTing/whatsgoingon/issues/new?template=bug-report.yml) or [feature request](https://github.com/NicholasTing/whatsgoingon/issues/new?template=feature-request.yml) form. Search existing issues first.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Larger changes:** open an issue to discuss the approach before writing code, so your work is not wasted if it does not fit the project.
- **Small fixes:** typos, docs, and obvious bugs can go straight to a pull request.
- **Looking for something to do?** Try issues labelled [`good first issue`](https://github.com/NicholasTing/whatsgoingon/labels/good%20first%20issue) or [`help wanted`](https://github.com/NicholasTing/whatsgoingon/labels/help%20wanted). Comment on the issue to say you are working on it.

## Set up

Use Node.js 24 or later.

```sh
# Replace YOUR_USERNAME with the username of your fork.
git clone https://github.com/YOUR_USERNAME/whatsgoingon.git
cd whatsgoingon
npm ci
npm run dev
```

Open <http://localhost:4173>. The frontend reloads as you edit; restart the server after changing `services.json` or files in `server/` or `shared/`.

## Project layout

| Path | Contents |
| --- | --- |
| `services.json` | Starter service array selected at build time (`enabled: true/false`) |
| `src/` | Read-only React frontend |
| `server/` | Node server, provider feeds (`feeds.ts`), catalogue (`catalog.ts`), alerts, and SQLite storage |
| `shared/` | Types and board logic used by both sides |
| `tests/*.test.ts` | Unit tests (`node --test`) |
| `tests/browser/` | Playwright browser and accessibility tests |

### Adding a provider

Most providers use Atlassian Statuspage. If `https://<status-site>/api/v2/summary.json` returns JSON, add a `statuspage(...)` entry to `server/catalog.ts`, then add its ID with `enabled: true` to `services.json`, restart the development server, and check its status-page link and live components. Production changes require a rebuild and redeploy. Include the status page URL in your pull request description. Providers with a different feed format need an adapter in `server/feeds.ts` and a unit test using a recorded response.

Add the provider's SVG mark to `public/logos/` and register its ID in `src/ProviderLogo.tsx`. Record its source and license in `public/logos/NOTICE.md`. Custom or unrecognized services use a globe icon. Logos are served locally.

## Make a change

1. Fork the repository and create a branch from `main`, for example `fix/stale-history` or `feat/add-provider-x`.
2. Keep each pull request focused on one change.
3. Add or update tests for behaviour you change.
4. Run the checks:

   ```sh
   npm run check                  # unit tests, type check, build
   npx playwright install chromium
   npm run test:e2e               # browser and accessibility tests, for UI changes
   ```

5. Update the README or `docs/` if user-facing behaviour changes.
6. Never commit credentials, webhook URLs, routing keys, `watch.config.json`, `.env` files, or private endpoints.

Write commit messages in the imperative mood, such as "Add Fly.io to the catalogue".

## Open a pull request

- Fill in the pull request template and link the issue it resolves (`Closes #123`).
- Include screenshots for visible UI changes.
- CI must pass. For first-time contributors, a maintainer approves the workflow run before CI starts.
- CodeRabbit posts an automated review. Address or reply to its comments; a maintainer makes the final decision.
- A maintainer reviews every pull request. Pull requests are squash-merged into `main`.

If a pull request goes quiet for a few weeks it may be closed. You are welcome to reopen it when you return.

## Questions

Open an issue, or comment on the one you are working on.
