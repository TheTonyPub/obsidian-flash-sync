# Repository instructions

## Product and layout

- Repository: `obsidian-flash-sync`; public Obsidian plugin identity: `flash-sync`.
- Plugin supports Desktop and Mobile; CLI executable is `fos`.
- `packages/plugin/src/main.ts`: Obsidian lifecycle, settings, vault adapters, and UI.
- `packages/plugin/src/markdown-sync.ts`: capture, reconciliation, file lifecycle, and conflicts.
- `packages/plugin/src/local-store.ts`: durable IndexedDB state and outbox.
- `packages/plugin/src/connection.ts`: direct NATS connectivity and KV access.
- `packages/plugin/src/blob-storage.ts`: optional S3 content storage.
- `packages/protocol/src`: shared records, hashing, paths, and protocol contracts.
- `packages/server-cli/src`: server administration, provisioning, credentials, and handoffs.
- `tests/unit`, `tests/integration`, `tests/simulation`: progressively broader verification.
- `scripts`: build, packaging, and verified publication tooling.
- `.github/workflows`: checks, tag artifacts, and explicit plugin publication.
- `openspec/specs` and active change deltas: requirements; `docs`: operator references.
- Preserve existing internal package names and deployed-state paths; public branding does not authorize migration.

## Architecture and invariants

- Synchronization connects directly over WSS to NATS JetStream KV; do not add a custom sync API or database.
- A local vault binds to a stable `vaultId` and its own `OBS_<vaultId>_FILES` bucket.
- NATS authenticates per-vault users; bucket permissions enforce isolation. A vault ID is not a credential.
- Use dedicated vault credentials in Obsidian, never the CLI administrator credential.
- Store plugin secret values in Obsidian SecretStorage; ordinary settings hold opaque references.
- Persist local changes in the durable outbox before treating them as pending synchronization.
- Retain pending content until remote mutation succeeds or a conflict copy preserves it.
- Keep stable `fileId` independent of path; preserve identity across rename.
- Use KV revisions and CAS for ordering and conflict detection, never client clock comparisons.
- Preserve conflict content and persistent delete tombstones; remote apply must be idempotent.
- Preserve feedback-loop suppression and durable delete/path-release ordering before path reuse.
- Reconnect reconciles local and remote state; report convergence only when work actually completes.
- Mobile suspension is not background synchronization.
- Normal content that fits the inline limit stays in KV. Default inline limit is 512 KiB.
- S3 is optional. Without it, inline content still syncs; blob-dependent files stay local and unsynced.
- Configured blobs use content addressing and integrity checks; do not put ordinary Markdown on the S3 path.
- Read current specs and active deltas for behavior details; historical targets are not measured guarantees.

## Discovery and implementation

- Use English for output, code, comments, documentation, and commit messages.
- With `.codegraph/`, use CodeGraph once when first exploring an unfamiliar area; reuse findings.
- Read known files/ranges directly; use `rg` for exact text and non-code artifacts.
- If the index is absent, unavailable, or stale, use targeted reads/searches; do not rebuild it without request.
- Use an existing Graphify graph only for unresolved broad cross-artifact questions; do not invoke both by default.
- Read the relevant OpenSpec change before implementation. Follow its acceptance criteria and edit boundaries.
- Establish reuse boundaries before introducing another implementation of existing behavior.
- Keep changes scoped; resolve material contract conflicts before dependent edits.
- Primary owner implements tests, code, and docs directly when capable; delegate only for concrete benefit.
- Keep one implementation owner per coherent feature; no agent per checkbox or TDD phase.
- Do not revert others' changes. Report unexpected working-tree changes before modifying overlapping files.
- Use requirement-derived TDD for behavior; mechanical docs/config changes need syntax/content checks.
- Start with focused tests, then run broader relevant checks at integration. Do not repeat unchanged passing checks.
- Distinguish local evidence, CI evidence, live release state, and unverified runtime behavior.

## Development commands

Use Node.js 22 and npm from the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm run build:plugin
npm run build:server-cli
npm run test:unit
npm run test:server-cli-bundle
npm run test:integration
npm run test:simulation
```

- Plugin output: `packages/plugin/dist/main.js`; source manifest: `packages/plugin/manifest.json`.
- CLI output: `packages/server-cli/dist/main.js` and `dist/admin-worker.js`.
- Test Obsidian installation only in a disposable vault; preserve real `.obsidian/` settings and vault data.
- Integration tests can require `NATS_SERVER_BIN`; Docker-backed checks require a running local Docker engine.
- See [CONTRIBUTION.md](CONTRIBUTION.md) for focused release tests, coverage, and disposable service commands.

## Branches and releases

- Branch feature work from `dev` into `codex/<topic>`; target ordinary feature/fix PRs into `dev`.
- Candidate fixes branch from and return to temporary `release/x.y.z` stabilization branches.
- `master` receives accepted stable source. Integrate release fixes into `dev` before retiring release branches.
- `x.y.z-dev.N` creates internal artifacts only; it cannot create a GitHub Release.
- Alpha/beta/optional rc tags create tested artifacts. Publication is an explicit operation, not a tag-push side effect.
- Candidate publication requires the matching release branch and explicit tag, run, attempt, and artifact identity.
- Publication runs trusted helper code from the repository default branch, which need not be `master`.
- Stable `x.y.z` and selected candidate tags must resolve to the exact same commit reachable from `master`.
- Reuse tested JavaScript/CSS; stable promotion changes only manifest version and verifies the package.
- Never compile during publication, select latest artifacts implicitly, move tags, or replace published assets.
- Publish complete verified drafts; prereleases are not latest, stable publication is latest.
- Missing/corrupt/expired evidence blocks promotion; matching retries resume drafts or verify completed releases.
- Do not create live tags/releases, merge branches, or change GitHub settings merely to prove local acceptance.
- Follow [CONTRIBUTION.md](CONTRIBUTION.md) for the full cycle and operator actions.

## CLI and operational boundaries

- `fos` administers the host where it runs; it does not provision remote servers through SSH.
- Supported modes are native, Docker Compose, and Podman Compose on documented Debian/Ubuntu amd64 hosts.
- CLI manages NATS/Caddy, vault buckets/users, protected credentials, handoffs, and explicit backup/lifecycle operations.
- Keep vault credentials, administrator credentials, import links, QR payloads, and phrases out of normal logs and Git.
- Preserve resource ownership checks, protected secret files, plan/confirmation behavior, and rollback boundaries.
- Developing or testing CLI code does not authorize operations on user-hosted services.
- Use disposable fixtures/services; require explicit authorization for deployment, configuration, rotation, upgrade, or removal on actual hosts.
- Plugin Releases do not distribute `fos`; preserve its separate source installation workflow.
- References: [CLI install](docs/fos-install.md), [CLI usage](docs/fos-usage.md), [NATS setup](docs/nats-setup.md).
