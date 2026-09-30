## Why

Beta testers need one path from nothing to a syncing vault: install the plugin through BRAT, provision a remote server with `fos`, and import the generated settings. Today these steps are spread over README, `fos-install`, `fos-usage`, `nats-setup` and `iphone-setup`, and some of those still name the plugin `easy-sync` or `flash-osidian-sync`.

## What Changes

- Add `docs/beta-tester-guide.md`: BRAT install (with a manual fallback), remote server setup with `fos` over SSH, handoff import on Desktop and mobile, verification, second device, troubleshooting and what to report.
- Link it from `README.md` and `docs/iphone-setup.md`.
- Fix stale plugin names and settings paths in `docs/nats-setup.md` and `docs/diagnostics.md`.

Non-goals: code, CLI behavior, release process, or a BRAT-specific build or manifest.

## Impact

- Docs only: `docs/beta-tester-guide.md`, `README.md`, `docs/iphone-setup.md`, `docs/nats-setup.md`, `docs/diagnostics.md`.
- Specs: none (`skip_specs`).
