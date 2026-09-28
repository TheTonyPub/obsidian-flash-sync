## Why

`fos` has terminal colors and an installation-mode selector, but the rest of bootstrap uses basic text questions and vault management requires operators to know command flags and vault IDs. A consistent GitHub CLI-style prompt experience will make server setup and routine vault management easier while preserving automation.

## What Changes

- Provide a shared terminal prompt layer for selection, validated input, secret input, and confirmation, with consistent colors, descriptions, defaults, and cancellation.
- Upgrade `fos bootstrap` to a guided flow with keyboard selection, field validation, a highlighted redacted plan, and a final confirmation that defaults to cancellation.
- Make `fos vault add` prompt for missing values in an interactive terminal, review creation choices before mutation, and reuse existing credential and Obsidian handoff behavior.
- Add an interactive browser at `fos vault` for selecting existing vaults, viewing details, opening the existing import handoff flow, and starting vault creation. Keep `fos vault list` as a table or JSON command; add explicit `--interactive` to open the same browser.
- Preserve explicit flags, unattended execution, protected secret destinations, machine-readable output, and plain terminal fallbacks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-provisioning`: Consistent typed terminal prompts, validated bootstrap fields, safe confirmation defaults, and output/cancellation compatibility.
- `vault-provisioning`: Guided vault creation and an explicit interactive vault browser that reuses existing administration and import behavior.

## Impact

- CLI entry point and terminal UI in `packages/server-cli/src/main.ts` and `ui.ts`, orchestration contracts in `cli.ts`, and related CLI help and documentation.
- A Node.js prompt dependency, provisionally `@inquirer/prompts`, with the selected version required to support Node.js 22 and the existing bundled CLI distribution.
- Unit tests for orchestration and prompt boundaries, packaged CLI checks, and disposable terminal verification.
- Existing NATS administration, bucket isolation, protected credential storage, and handoff invariants remain authoritative. No plugin behavior, protocol, server topology, or public identity changes.
- Actual host deployment and runtime operations remain user-owned non-goals. This change does not implement remote SSH provisioning, a full-screen dashboard, credential rotation/revocation menus, or a new administration backend.
