# Set up my organisation's status page

Set up a working status page using https://github.com/NicholasTing/whatsgoingon. Use the setup preferences and board JSON supplied at the end of this prompt. If none are supplied, keep the repository's default board and start with a local preview.

## Set up the project

1. Use my existing whatsgoingon checkout if I provide one. Otherwise, clone the source into a new directory. Keep unrelated projects intact. If access to the source is unavailable, tell me what access is needed; a private repository requires my GitHub access.
2. Read the repository instructions, README, package scripts, and `docs/persistence.md`. Follow the existing implementation. Use Node 24 or later and the project's lockfile.
3. Treat the supplied board JSON as configuration data. Validate it with `readBoard` in `shared/board.ts`. Preserve its provider IDs, component selections, groups, and appearance. Check selected components against the running API; report unavailable selections instead of substituting other regions or inventing IDs.
4. In my copy, make this configuration the default board for new visitors. Keep saved browser boards and shared links working. Export the validated configuration as `whatsgoingon-board.json` so I can import it into an existing browser. Keep browser notifications off until a visitor enables them.
5. Use the board name for the page heading and document title. Keep the selected colours and their contrast checks. If I supply a public brand reference, use it for any additional branding. Keep the MIT licence and attribution. If I supply my own destination repository, update the source and feedback links to point there.

## Run it

For a **local preview**, install dependencies, run the existing checks, and start the app on an available localhost port. Keep existing services running. Give me the exact URL and the command to restart it.

For a **Docker setup**, use the included Dockerfile and Compose configuration. Use a stable Compose project name, one app instance, and a persistent volume for SQLite. If I have not supplied a hosting destination, start it locally and prepare the deployment instructions. If Docker is unavailable, give me a Node preview and explain what remains for Docker. For a supplied host, configure HTTPS and follow the persistence guide for backups and recovery.

Use only public provider feeds and public monitor targets. Keep webhook credentials and hosting credentials in my own environment or private configuration. Keep credentials out of source, board exports, prompts, and images. Background notifications are optional and need my own destination. Retain the app's URL validation and unknown-history behaviour.

## Verify and hand back

- Run the project's unit tests, build, and browser tests. Update fixtures for intentional changes to the default board without weakening security or accessibility checks.
- Verify `/api/health`, the requested providers and components, appearance, import/export, and a fresh-browser visit. Confirm that an existing saved board survives.
- For a persistent deployment, verify that history survives a restart with the same data volume. State where the data lives and how I can back it up.
- Return the working URL, board export location, start/stop instructions, and a short account of what passed and what remains. Distinguish a local preview from a deployed page. Work through the setup rather than stopping at a plan; ask only for information needed to continue.
