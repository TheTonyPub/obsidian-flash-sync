## 1. Beta tester guide

Execution notes: base branch `dev`; docs only, no secrets or real hostnames; read `README.md`, `docs/fos-*.md`, `docs/nats-setup.md`, `docs/iphone-setup.md` and the `credential-import-handoff` and `settings-ui` specs; keep existing package names and deployed-state paths.

- [x] 1.1 Write `docs/beta-tester-guide.md`. Done when it covers BRAT install, `fos` server setup, import on Desktop and mobile, verification, second device, troubleshooting and reporting, and every UI label and command matches the code and current docs.
- [x] 1.2 Link the guide from `README.md` and `docs/iphone-setup.md`; replace `easy-sync` and `flash-osidian-sync` plugin names and settings paths in `docs/nats-setup.md` and `docs/diagnostics.md`. Done when `rg "easy-sync|flash-osidian-sync" docs README.md` shows only package names and deployed-state paths.
- [ ] 1.3 Run `openspec validate beta-tester-setup-guide --strict` and check relative links. Done when both pass.

## 2. Owner checks (deferrable)

- [ ] 2.1 On a disposable vault and server, follow the guide end to end, including BRAT adding a prerelease, and record any deviation. Done when the owner accepts the guide.
