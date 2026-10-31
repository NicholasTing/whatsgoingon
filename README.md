# Issue 18 review evidence

Source commit: `0e6b2110c3d3416f9f5c8ff26345f42587208bfc`. Base: `d57fc0f703b5bdfb4b189c8a4931bf0aea413b71`.

The incident filter used an operating-system select popup in the current code, matching the issue screenshot. The replacement uses the board colours, spacing, selected checkmark and focus outlines.

## Local results

- `npm ci`: passed; 0 vulnerabilities reported.
- `npm audit --audit-level=high`: passed; 0 vulnerabilities.
- `npm run check`: passed; 23 unit tests, TypeScript and production build.
- `npx playwright install chromium`: passed.
- `npm run test:e2e -- --config playwright.issue-18.config.ts`: passed; 18 browser tests.
- `git diff --check`: passed.

The normal test port 4175 was occupied. The included untracked config changes only 4175 to 49697; the existing server was left running. Local environment: macOS, Node v26.9.0, npm 11.19.1. CI uses Node 24 and the unchanged repository config.

New regression coverage: all four filter outcomes; pointer and emulated touch selection; reselecting an option; Enter/Space opening; Tab and arrow navigation; Enter/Escape, outside-click and Tab-away dismissal; focus restoration; light/dark axe WCAG checks; menu containment at 1280, 390 and 320 pixels.

All eight screenshots were visually inspected, including visible keyboard focus. The screenshots use deterministic mocked board/provider responses and a fixed time of 2026-10-31T12:00:00Z. They are not evidence of live provider health and contain no user data, tokens or private endpoints. No Firefox, Safari, physical-device or manual screen-reader checks were performed.

## Screenshots

- [Dark desktop](filter-Midnight-1280.png) and [light desktop](filter-Slate-1280.png)
- [Dark 320px](filter-Midnight-320.png) and [light 320px](filter-Slate-320.png)
- [Dark 390px](filter-Midnight-390.png) and [light 390px](filter-Slate-390.png)
- [Dark keyboard focus](filter-Midnight-keyboard.png) and [light keyboard focus](filter-Slate-keyboard.png)

[Install log](npm-ci.log) · [Unit/build log](check.log) · [Browser log](e2e.log) · [Audit log](audit.log)
