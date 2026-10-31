# Security policy

## Supported versions

Security fixes are made on the `main` branch. Run the latest commit, or rebuild your Docker image from it, to receive them.

## Reporting a vulnerability

**Do not report security vulnerabilities in public issues, discussions, or pull requests.**

Report them privately through GitHub: open the [Security tab](https://github.com/NicholasTing/whatsgoingon/security) and choose **Report a vulnerability**, or use [this form](https://github.com/NicholasTing/whatsgoingon/security/advisories/new) directly.

Include:

- What the issue is and what an attacker could do with it.
- Steps or a proof of concept to reproduce it.
- The affected commit, file, or endpoint, if known.

You should receive an acknowledgement within 7 days. Once the issue is confirmed, a fix is prepared in a private advisory and released as soon as practical. You will be credited in the advisory unless you ask otherwise.

## Scope

Areas of particular interest:

- Server-side request forgery through custom endpoint monitors (the server is meant to reach public HTTPS hosts only).
- Injection through share links, imported boards, or provider feed content.
- Leaks of webhook URLs, routing keys, or other alert configuration.

Reports that depend on running the app with a deliberately unsafe configuration, or on access to the host machine, are out of scope.
