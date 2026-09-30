# CLAUDE.md

Guidance for Claude Code in this repository. `AGENTS.md` holds the same rules for other
agents; when you change one, update the other in the same edit.

## What this is

`obsidian-flash-sync`: self-hosted realtime sync for Obsidian vaults. The public plugin
identity is `flash-sync` (Desktop and Mobile), and the host CLI is `fos`. One Git
repository with npm workspaces on Node.js 22.

| Path | Owns |
|---|---|
| `packages/plugin/src/main.ts` | Obsidian lifecycle, settings, vault adapters, UI |
| `packages/plugin/src/markdown-sync.ts` | Capture, reconciliation, file lifecycle, conflicts |
| `packages/plugin/src/local-store.ts` | Durable IndexedDB state and outbox |
| `packages/plugin/src/connection.ts` | Direct NATS connectivity and KV access |
| `packages/plugin/src/blob-storage.ts` | Optional S3 content storage |
| `packages/protocol/src` | Shared records, hashing, paths, protocol contracts |
| `packages/server-cli/src` | `fos`: administration, provisioning, credentials, handoffs |
| `tests/unit`, `tests/integration`, `tests/simulation` | Progressively broader verification |
| `scripts`, `.github/workflows` | Build, packaging, checks, tag artifacts, explicit publication |
| `openspec/` | Requirements: accepted specs, active changes, archive |
| `docs/`, `docs/design/` | Operator references; visual references |

Keep existing internal package names and deployed-state paths. Public branding does not
authorize a migration.

## Invariants — never break these

- Sync connects directly over WSS to NATS JetStream KV. No custom sync API or database.
- A local vault binds to one stable `vaultId` and its own `OBS_<vaultId>_FILES` bucket.
- NATS authenticates per-vault users, and bucket permissions isolate vaults. A vault ID is not a credential.
- Obsidian uses dedicated vault credentials, never the CLI administrator credential.
- Secret values go to Obsidian SecretStorage; ordinary settings hold only opaque references.
- A local change is persisted in the durable outbox before it counts as pending sync.
- Pending content stays until the remote mutation succeeds or a conflict copy preserves it.
- `fileId` is independent of path and survives renames.
- Ordering and conflict detection use KV revisions and CAS, never client clocks.
- Keep conflict content and persistent delete tombstones. Remote apply is idempotent.
- Keep feedback-loop suppression and durable delete/path-release ordering before a path is reused.
- Reconnect reconciles local and remote state. Report convergence only when the work really completed.
- Mobile suspension is not background sync.
- Content within the inline limit (default 512 KiB) stays in KV. Ordinary Markdown never goes to S3.
- S3 is optional. Without it, inline content still syncs and blob-dependent files stay local.
- Configured blobs use content addressing and integrity checks.
- Behavior details come from current specs and active deltas. Historical targets are not measured guarantees.

## OpenSpec

- `openspec/specs/<capability>/spec.md` is the accepted baseline. Active work lives in
  `openspec/changes/<id>/`; finished changes move to `openspec/changes/archive/`.
- `openspec/config.yaml` sets the context and the size limits for proposals, designs, specs
  and tasks. Follow it whenever you write or apply a change.
- Use `/opsx:explore`, `/opsx:propose`, `/opsx:update`, `/opsx:apply`, `/opsx:sync` and `/opsx:archive`.
- Apply a change only when its `proposal.md` starts with `> Approved:`. Otherwise stop and ask.
- Read only the active change and the requirements it touches. For the large baseline
  `openspec/specs/obsidian-realtime-sync-architecture.md`, read only the sections you need.
- Plan approval, local checks, owner acceptance and release are separate states.

```sh
openspec validate <change-id> --strict
openspec validate --all --strict --no-interactive
```

## Design references

- Settings UI: `docs/design/settings-ui/design-qa.md`, `reference/*.png` and
  `source/*.dc.html`. Match structure and copy. Take colors from Obsidian theme variables,
  never from the mockup hex values.
- A change that alters visual direction updates the PNGs, sources and `design-qa.md`
  together, or marks the captures as pending.

## How to work

- Write output, code, comments, docs and commit messages in English.
- Discovery: when `.codegraph/` exists, call `codegraph_explore` (or `codegraph explore`) once
  per unfamiliar area and reuse what it returns. Read known files and ranges directly. Use
  `rg` for exact text and non-code files. If the index is missing or stale, fall back to
  targeted reads; do not rebuild it unless asked. Use a Graphify graph only for broad
  cross-artifact questions CodeGraph cannot answer.
- Read the relevant OpenSpec change before implementing, and stay within its acceptance
  criteria and edit boundaries. Find what to reuse before writing a second implementation
  of existing behavior.
- Keep changes scoped. Resolve material contract conflicts before editing dependent code.
- Do the tests, code and docs of one feature yourself. Spawn subagents only for a concrete
  cost or time benefit, never one per checkbox or TDD phase.
- Do not revert others' work. Report unexpected working-tree changes before touching overlapping files.
- Behavior uses requirement-derived TDD: failing test, implementation, passing test.
  Mechanical docs/config edits need only syntax and content checks.
- Run focused tests first, broader suites at integration. Do not rerun unchanged passing checks.
- Report local evidence, CI evidence, live release state and unverified runtime behavior separately.
- Do not commit, push, tag, create branches or open PRs unless asked.

## Commands

Run from the repository root:

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

- Plugin output: `packages/plugin/dist/main.js`. Source manifest: `packages/plugin/manifest.json`.
- CLI output: `packages/server-cli/dist/main.js` and `dist/admin-worker.js`.
- Integration tests may need `NATS_SERVER_BIN`. Docker-backed checks need a running local Docker engine.
- Test Obsidian installs only in a disposable vault. Keep real `.obsidian/` settings and vault data intact.
- [CONTRIBUTION.md](CONTRIBUTION.md) covers focused release tests, coverage and disposable services.

## Branches and releases

- Ordinary feature and fix PRs target `dev`.
- Candidate fixes branch from and return to temporary `release/x.y.z` branches.
- `master` receives accepted stable source. Merge release fixes into `dev` before retiring a release branch.
- `x.y.z-dev.N` tags create internal artifacts only and cannot create a GitHub Release.
- Alpha, beta and optional rc tags create tested artifacts. Publication is an explicit
  operation, never a side effect of pushing a tag.
- Publishing a candidate requires the matching release branch plus an explicit tag, run, attempt and artifact identity.
- Publication runs trusted helper code from the default branch, which need not be `master`.
- A stable `x.y.z` tag and the selected candidate tag resolve to the same commit reachable from `master`.
- Stable promotion reuses the tested JavaScript and CSS, changes only the manifest version, and verifies the package.
- Never compile during publication, pick the latest artifacts implicitly, move tags, or replace published assets.
- Publish only complete, verified drafts. Prereleases are not "latest"; a stable release is.
- Missing, corrupt or expired evidence blocks promotion. A matching retry resumes the draft or verifies the finished release.
- Do not create live tags or releases, merge branches, or change GitHub settings just to prove local acceptance.
- [CONTRIBUTION.md](CONTRIBUTION.md) describes the full cycle and the operator's steps.

## CLI and operations boundaries

- `fos` administers only the host it runs on. It does not provision remote servers over SSH.
- Supported modes: native, Docker Compose and Podman Compose on documented Debian/Ubuntu amd64 hosts.
- `fos` manages NATS/Caddy, vault buckets and users, protected credentials, handoffs, and explicit backup and lifecycle operations.
- Never print or commit vault or admin credentials, import links, QR payloads or phrases,
  including in tool output, test fixtures and screenshots.
- Keep resource ownership checks, protected secret files, plan/confirmation behavior and rollback boundaries.
- Writing or testing CLI code does not authorize actions on user-hosted services. Use
  disposable fixtures. Deploying, configuring, rotating, upgrading or removing anything on a
  real host needs explicit authorization from the owner.
- Plugin releases do not ship `fos`; keep its separate source installation workflow.
- References: [CLI install](docs/fos-install.md), [CLI usage](docs/fos-usage.md), [NATS setup](docs/nats-setup.md).
