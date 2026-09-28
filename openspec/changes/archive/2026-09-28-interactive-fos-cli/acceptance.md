# Local acceptance: interactive-fos-cli

Verified on 2026-09-28 on branch `codex/interactive-fos-cli`, using the repository's Node.js 22.23.2 runtime. Local implementation checks and the separately authorized remote CLI installation are recorded below. This file does not claim CI or release acceptance.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run test:unit` | 60 files, 524 tests passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build:server-cli` | Passed; both ESM bundles built |
| `npm run test:server-cli-bundle` | Passed; isolated package starts without `node_modules`, help and early output/flag errors verified |
| `vitest run tests/integration/server-cli-bundle.test.ts tests/integration/server-cli-terminal.test.ts` | 2 files, 2 tests passed after final implementation changes |
| `NATS_SERVER_BIN=<disposable NATS 2.15.0 binary> vitest run tests/integration/nats-permissions.test.ts` | Passed; two-vault permissions and absent/wrong/revoked authentication tested |
| `NATS_SERVER_BIN=<disposable NATS 2.15.0 binary> vitest run tests/integration/server-cli-guided-nats.test.ts` | Passed; real native KV creation, scoped authentication/read/write/watch verification, preserved seed content, and repeated-add protection |
| `openspec validate interactive-fos-cli --strict` | Passed |
| `git diff --check` | Passed |

Commands run with the repository's `node_modules/.bin` first in PATH. Disposable NATS checks needed sandbox escalation to bind a random loopback listener. No actual managed server was accessed. Docker availability was inspected; no Docker/Podman host installation was applied.

## Requirement evidence

### Server provisioning

- **Clear terminal and machine-readable output:** policy unit tests require both TTY streams, preserve `NO_COLOR` keyboard selection, disable collection for JSON/unattended execution, and choose plain `TERM=dumb` prompts. Packaged CLI checks verify help, finite listing dispatch, incompatible browser/JSON flags, non-terminal rejection, and protected-output requirements before service access. Existing UI tests preserve table/JSON and protected UTF-8 QR formatting.
- **Consistent terminal prompts:** stream-level tests verify arrow/Enter selection, input correction, cancellation cleanup, default cancellation, sanitization, and non-echoing secret input. The disposable PTY harness exercises actual terminal input, 10-row/35-column menus, pagination to a Unicode label, default cancellation, `NO_COLOR`, plain fallback, and exit status 130. It verifies restored termios on the shared prompt fixture before macOS revokes its controlling terminal at exit, and restored cursor visibility on rich prompts. The packaged bootstrap is separately exercised through invalid domain input and Ctrl+C.
- **Guided bootstrap fields and review:** orchestration tests verify typed choices/descriptions, validators, supplied-field precedence, invalid email rejection, and interactive `--approve` confirmation. Existing bootstrap, credential, state, and recovery tests pass with valid email fixtures, including explicit protected output and unattended input behavior.

### Vault provisioning

- **Guided vault creation:** tests prove read-only authentication/user/bucket preflight before phrase collection, zero mutation on cancellation, collision detection, protected output, `--keep`, existing-bucket preservation, post-review user races, verification failures, and unattended/JSON compatibility. Disposable NATS verifies the composed bucket/user sequence against real KV and scoped credentials while retaining another vault's seeded content.
- **Interactive vault browser:** tests cover terminal/help entry points, empty lists, stale selections, refreshed lists after creation, import unavailability without retention, protected retained-credential import, endpoint overrides, and retained creation through browser options. Browser actions reuse existing orchestration and expose no destructive menus.
- **Vault command output compatibility:** finite list dispatch remains distinct from browser dispatch; help and invalid/conflicting options fail before service access. Redirected and JSON entry points do not construct interactive prompts or disclose handoffs.

## Findings resolved during verification

- PTY testing found the plain secret prompt announced readiness before disabling kernel echo. The adapter now disables echo and installs listeners before writing the label; PTY secret non-echo checks pass.
- Two existing bootstrap credential tests supplied `yes` for every question, including email. Their fixtures now supply a valid ACME email, preserving their protected-output/recovery assertions under the new validation contract.
- The initial disposable NATS fixture used a 250 ms connection deadline that was too short for bcrypt authentication. The fixture uses a 2 s deadline; production authentication deadlines were not changed.

## Authorized remote CLI installation

On 2026-09-28, the operator requested installation on `root@83.217.194.115`. The test host uses Node.js 22.22.1 and reports a managed Podman installation.

- Packed the tested workspace CLI into a three-file npm archive and installed it globally with lifecycle scripts disabled. The binary resolves to `/usr/local/lib/node_modules/@flash-osidian-sync/server-cli/dist/main.js`.
- Preserved the previous installed package and executable symlink target in `/root/fos-cli-backup-20260928-L86dWl` (directory mode 0700).
- Verified the transferred archive SHA-256: `8bb97be96320c6b3ae58815d186c741413d8fc7db80a2765b6f8bd149160d249`.
- Verified both installed bundles match local SHA-256 values: main `25629db222c12af55db87ab619ae6248f119e561e01e6b704ff269c2169ff561`; worker `14a629f59abcfe159948aa2987667389fd25cd7ad93144bd8b6623b4c1e2830a`.
- `fos status`, `fos vault --help`, and `fos vault list --json` succeeded. Status reports `MANAGED — podman`.
- In an SSH PTY with `TERM=xterm-256color`, bootstrap rendered its mode menu, accepted Down/Enter to select Docker Compose, and reached the domain input. Ctrl+C restored cursor visibility and returned 130 before approval.
- The live vault browser rendered colored choices for five existing vaults plus Add and Exit. Down-arrow navigation and Enter on Exit returned 0 and restored cursor visibility.
- Installation replaced only the CLI package. No bootstrap application, vault mutation, credential rotation, or service upgrade was performed.

## Verification limits and operator actions

- Real SSH-shell rendering and navigation were exercised as recorded above. Human visual review remains separate from captured terminal evidence.
- Native NATS behavior and Compose adapter/worker unit contracts were checked. Complete Docker/Podman installation, reload, TLS, firewall, and deployment acceptance on supported Linux hosts were not executed in this change.
- The authorized test-host CLI installation is recorded above. No managed services, credentials, tags, releases, or GitHub settings were changed. No publication, main-spec synchronization, or archive was performed.
- Use the normal CLI source build/install workflow when an operator chooses to install this version. Prompt cancellation before approval is mutation-free; interruption after apply begins retains existing recovery boundaries and does not promise rollback.

## Authorized closure

On 2026-09-28, the operator requested main-spec synchronization, archive, and integration into `dev`. All 20 tasks are complete. Both capability deltas were merged into their main specs, every delta requirement was verified in the resulting specs, and strict validation passed for all 15 main specs. The completed change is archived as `2026-09-28-interactive-fos-cli`. Deployment limitations above remain unchanged by closure.

After archive, `openspec validate --all --strict` passed all 15 main specs but failed the unrelated active change `remote-ssh-server-bootstrap` because it has no delta specs. That existing change was not modified.
