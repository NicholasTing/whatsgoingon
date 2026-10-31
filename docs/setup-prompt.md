# Audit this repository and set up its dependency status page

Audit the organisation codebase open in this session, review the dependency inventory with me, then start a status dashboard for the agreed services using https://github.com/NicholasTing/whatsgoingon. Set up monitoring for the services you find; the application you start is the status dashboard.

The starting board supplied below is a seed, not the complete inventory. Preserve its selections and appearance while adding services from the audit. Without a seed, use the audit results, the AI defaults below, the app's default appearance, and a local preview.

## 1. Establish the audit target

Record the current working directory, repository root, branch, and any existing changes before cloning or switching directories. Read the target's repository instructions and identify its apps, packages, infrastructure, and deployment roots. Audit this source repository read-only. Keep its code, running services, and data intact.

If this session is in the whatsgoingon repository itself, an empty folder, or an ambiguous multi-repository workspace, ask for the organisation repository path. Once the target is known, retain that absolute path throughout the audit. A later dashboard checkout is a separate destination, not a replacement audit target.

## 2. Discover dependencies across the codebase

Use `rg --files --hidden` and targeted searches, respecting ignore rules and excluding generated output, vendored code, and dependency caches. Inspect each application and infrastructure root, not just the top-level manifest. Cover these evidence sources where present:

| Evidence | Look for |
| --- | --- |
| Workspace manifests, direct dependencies, and relevant lockfile entries | SDKs, package registries, databases, queues, and service clients across every language in use. |
| Application code and integration configuration | Outbound API clients, authentication, payments, email, storage, analytics, observability, data platforms, and AI services. Trace SDK declarations to actual usage. |
| Terraform, Pulumi, CloudFormation, Kubernetes, Helm, Docker, and deployment files | Cloud products, hosting providers, managed versus self-hosted services, and configured regions or environments. |
| CI workflows, release scripts, and registry configuration | Source hosting, CI providers, container registries, deployment services, and external build dependencies. |
| Example environment files and configuration schemas | Variable names and service types. Keep secret values and private addresses out of the report and board. |
| READMEs, architecture docs, runbooks, and agent/tool configuration | Operational dependencies and developer tools absent from manifests. Separate active use from examples, tests, and historical references. |

Inspect committed, non-secret configuration. Exclude private `.env` files, credentials, Terraform state, database contents, and secrets stores. Record safe file-and-line references rather than copying configuration values.

Distinguish hosted services from local libraries and self-hosted components. A database driver alone does not identify its hosting provider. An SDK declaration alone does not establish active production use. Label uncertain findings as inferred and explain the missing evidence. Separate runtime dependencies from development and CI tools, and deduplicate repeated references without losing product or region scope.

Include **Claude** (catalogue ID `claude`) and **Codex** (catalogue ID `codex`) by default, even if neither appears in the code. Label them **setup default** and include each only once. Preserve existing selections and groups; put new entries under AI & developer tools. I can remove either during the review.

The audit is complete when every application/infrastructure root and applicable evidence category has been checked or explicitly marked inaccessible. Return a coverage summary and an inventory with these columns:

**Service | Purpose/environment | Evidence file:line or setup default | Confirmed/inferred | Product/region | Proposed monitor or unresolved gap**

Keep declared libraries that do not imply an external service in the audit notes, rather than turning every package into a monitor. Save the coverage summary and inventory in a local report outside both repositories, so detailed evidence stays out of published assets and commits.

## 3. Map monitors and review the inventory with me

Once the audit is complete, use a dashboard destination I name or clone whatsgoingon into a separate sibling directory. If a previous attempt exists, inspect and reuse it without overwriting my changes. If source access is unavailable, explain the access needed. Read the dashboard's repository instructions and keep the organisation repository as the audit source.

Use the status app's catalogue and live provider components to map the inventory. Verify official public status pages or feeds for services missing from the catalogue. Use a supported custom status-feed monitor where possible. A public HTTPS check is appropriate only for a health endpoint I choose; a marketing homepage returning 200 is not evidence of provider health.

Show unsupported providers, private/self-hosted services, and ambiguous scopes as gaps. If an agreed provider needs a new feed adapter, add the smallest adapter supported by a verified public feed and test its parsing and failure behaviour. If no usable source exists, state the limitation and the information or capability needed. Account for every discovered service, including those that cannot yet be monitored.

Present one proposed monitoring list for review. Include discovered services, seed selections, and the Claude/Codex defaults, with each source identified. Ask me to confirm the list, resolve uncertain regions or environments, and add tools used outside the codebase. While I review it, you can install the dashboard's dependencies and run its checks. Use choices I have already supplied; avoid repeated confirmation. Build the final board from the agreed inventory.

## 4. Configure and start the dashboard

Work in the separate dashboard checkout. Read its README, package scripts, and `docs/persistence.md`. Use Node 24 or later and its lockfile. Merge the agreed monitors with the seed configuration, preserving selected components, groups, and colours. Validate with `readBoard` in `shared/board.ts` and check component IDs against live feeds. If the inventory exceeds board limits, agree how to split it into boards; never silently truncate it.

Make the agreed board the default for new visitors in my copy. Keep existing saved boards and shared links working. Export `whatsgoingon-board.json` for an existing browser. Use the board name for the page heading and document title, retain contrast checks and the MIT licence, and update source/feedback links if I provide my own repository. Keep browser notifications off until enabled by the visitor.

For a **local preview**, install dependencies, run checks, and start the dashboard on an available localhost port. For a **Docker setup**, use the included Dockerfile and Compose configuration, a stable project name, one app instance, and a persistent SQLite volume. Without a hosting destination, start locally. If Docker is unavailable, provide a Node preview and explain what remains for Docker. For a supplied host, configure HTTPS and follow the persistence guide for backup and recovery.

Use public feeds and public monitor targets. Keep webhook and hosting credentials in my own environment or private configuration. Background notifications are optional and require my destination. Retain URL validation and unknown-history behaviour.

## 5. Verify and hand back

- Run the unit tests, build, and browser tests. Update fixtures for intentional default-board changes without weakening security or accessibility checks.
- Verify `/api/health`, each configured provider and component selection, appearance, import/export, and a fresh-browser visit. Confirm that existing browser boards survive.
- For a persistent deployment, verify that history survives a restart with the same volume. State the data location and backup procedure.
- Reconcile the audit inventory against the final board: monitored, excluded by me, or unresolved with a reason. Verify Claude and Codex are present unless I opted out. Report failed or stale feeds as unknown, not healthy.
- Return the working URL, audit report and board export locations, start/stop instructions, checks performed, and unresolved gaps. Distinguish a local preview from a deployed page. Continue through setup after the inventory review; the audit alone is not the finished task.
