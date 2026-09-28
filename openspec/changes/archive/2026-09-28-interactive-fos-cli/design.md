## Context

See `proposal.md` for motivation and the two delta specs for acceptance contracts. The CLI currently has human output formatting and a custom raw-terminal selector in `ui.ts`. `main.ts` selects prompt behavior by matching question text, uses readline for ordinary input, and owns a separate secret-input loop and SIGINT handler. `cli.ts` separates orchestration from host adapters but exposes string-question callbacks. `helpTopicForArgs` treats bare `fos vault` as help. These existing boundaries are the reuse point; no second provisioning implementation is needed.

The CLI is bundled as Node.js 22 ESM with esbuild, together with a separate admin worker. NATS administration may run through native or Compose adapters. Terminal presentation must not alter that distribution or host ownership model.

## Goals / Non-Goals

**Goals:**
- Give one owner control of terminal input, cancellation, and prompt cleanup.
- Share typed prompt operations across bootstrap, vault creation, and browser navigation while keeping host logic testable without a terminal.
- Reuse existing validators, administration adapters, protected stores, and import handoff generation.

**Non-Goals:**
- Full-screen persistent UI, new privilege helper, SSH deployment, changes to the admin worker's role, and plugin settings or sync changes.
- Add rotation, revocation, deletion, or access-verification menus in this slice. Verification still runs as part of confirmed provisioning and remains available through its explicit command.
- Introduce interactive credential retention without `--keep`, or duplicate the existing backup and lifecycle wizards. Backup settings continue through existing flags.
- Deploy onto actual hosts as part of development acceptance.

## Decisions

### 1. Use a typed prompt adapter backed by Inquirer

Define prompt operations for selection with labels/descriptions, text input with defaults and validation, secret input, and confirmation. `cli.ts` consumes these injected operations; terminal rendering belongs in the entry/UI layer. Extract shared validation where necessary so explicit flags and entered values follow the same rules. Validation errors from entered values loop at the field; invalid flags fail instead of being replaced.

Use `@inquirer/prompts` as the rich-terminal implementation. Select and lock a release compatible with Node.js 22, then prove that release works in the existing ESM bundle. Resolve dependency compatibility before integrating flows. This provides the requested command-scoped interaction without writing more escape-sequence handling. Reuse existing output formatting and spinner behavior where compatible.

Alternatives: extending `selectTerminal` avoids a dependency but increases input, scrolling, Unicode, and cleanup responsibility; Clack favors a distinctive installer appearance over the requested GitHub CLI-style command prompts; Go libraries used by GitHub CLI require an unnecessary runtime/language change. None is preferred for this scope.

### 2. Make interaction and output policies explicit

Evaluate terminal input/output, unattended mode, supported JSON requests, `TERM`, and `NO_COLOR` once at the entry point. Distinguish rich prompts, plain interactive prompts, and noninteractive execution. `NO_COLOR` changes styling only. `TERM=dumb` uses a numbered readline adapter with the same validation and cancellation semantics. Redirected output disables collection even if stdin remains a terminal.

Preserve current finite table/JSON listing. Validate `--interactive` before service access; accept it only for `vault list`, reject it with `--json` or without both terminals. Bare `fos vault` opens the browser only with both terminals, otherwise retains help. Explicit help always bypasses browser construction and service access. Do not silently treat `--json` on a command that does not support it as a new output mode.

Structured vault commands must never disclose a handoff into JSON output. For supported JSON creation, require `--secrets-output` before mutation and disable disclosure callbacks. Errors remain clearly separated from successful structured results according to the existing CLI conventions; tests assert no prompt or secret contamination.

Alternatives: turning every `vault list` into a menu would change command termination and break scripts; requiring a new browser command alone would leave the existing `fos vault` entry less discoverable.

### 3. Upgrade bootstrap presentation at its existing orchestration boundary

Replace string-based prompt dispatch with typed collection in `collectInteractive`. Keep `buildBootstrapPlan`, existing explicit flag handling, protected input, host apply adapters, and state/credential recovery behavior. Provide installation descriptions; validate domain, optional email, and initial vault ID as fields; show the existing UFW and service-account options with consequences. Optional email is empty or valid; apply the same validation to a supplied value.

Show the existing formatted redacted preview before a confirmation with cancellation selected. Interactive `--approve` retains its current mandatory confirmation. Keep unattended collection and approval unchanged. Protected secret output is resolved before handoff disclosure; no secret enters review text or completed prompt history.

Alternatives: a separate bootstrap wizard with its own apply logic risks diverging plans and recovery; merely styling question strings leaves validation and prompt type detection fragile.

### 4. Add guided creation with a preflight and confirmation boundary

Extend existing vault orchestration rather than synthesizing shell commands or adding a separate user/bucket writer. Resolve a missing ID through the prompt adapter, validate explicit and entered IDs, resolve endpoint precedence, and use current administration adapters for read-only authentication and bucket/user/collision preflight. If current orchestration collects the QR phrase before these checks, move collection behind successful preflight.

Present ID, mode, endpoint, explicit retention choice, and terminal or protected-file destination without secret values. In interactive mode, confirmation precedes optional secret collection and every write. Existing user/collision outcomes use the existing error/idempotency contracts and skip phrase collection. Recheck mutable conditions at the existing administration boundary so concurrent changes cannot trigger implicit reset or rotation. Unattended fully specified add keeps its current behavior; no new approval flag is required for automation.

Keep existing bucket defaults and authorization implementations. A new-vault flow must ensure its matching bucket exists through the existing `createVault` administration operation before adding the user, after confirmation. Current `runVaultCommand` separates bucket creation from user addition, so compose those existing operations rather than assuming user addition creates the bucket. Preserve existing content when a bucket already exists. Confirmed add reuses existing own-bucket verification, credential persistence, and handoff output. `--keep` alone authorizes retention. A failure after confirmation must report the reached state through existing errors rather than deleting a pre-existing bucket or claiming complete provisioning.

Alternatives: collecting the phrase first unnecessarily requests a secret for operations that cannot proceed; automatically retaining credentials to make browser import work changes a security contract.

### 5. Build a command-scoped vault browser over existing actions

Add a bounded orchestration module under `packages/server-cli/src` for the browser if separating it from `cli.ts` improves clarity. List using the existing managed-mode resolution and administrator authorization. Represent menu labels separately from canonical vault IDs; sanitize display text, never change the identity passed to administration adapters.

The first menu offers existing vaults, Add new vault, and Exit. A selected vault offers Inspect, Import to Obsidian, Back, and Exit. Inspect dispatches to existing inspection; import dispatches to `runImportCommand`, which reads a retained record locally. Missing retention yields an explanation, not credential rotation. Add dispatches to the guided creation orchestration. Bare-action `fos vault` accepts only `--mode`, `--admin-input`, `--secrets-output`, `--wss-endpoint`, and `--keep`; mode and administrator input apply to administration, endpoint/output apply to add and import, and retention applies only to add. Unknown flags fail before service access. `vault list --interactive` accepts its existing list options plus `--interactive`; add/import use managed endpoint or prompted fallback, terminal handoff, and no retention. Help enumerates these exact accepted flags. Bare-action `fos vault --json` is rejected before service access because a browser has no structured result; `fos vault list --json` remains the structured entry point.

After a completed action or stale selection, reload list state. Back is navigation, not an edit-back wizard. Ctrl+C exits the command rather than returning to a menu. A post-apply interruption cannot promise rollback; retain existing recovery behavior and do not report success until verification completes.

Alternatives: caching the original list throughout the session gives misleading results after creation or concurrent changes; embedding destructive actions expands scope and confirmation risk.

### 6. Verify both orchestration and actual terminal behavior

Use injected adapters for requirement-derived unit tests: field correction, explicit values, confirmation defaults, zero writes before approval, preflight failure, retention/output selection, stale selections, and noninteractive policy. Use the packaged executable for help, flags, JSON, and dependency-bundle checks. Use a disposable pseudo-terminal harness for arrow/Enter navigation, Ctrl+C exit 130, restored input/cursor state, plain fallback, `NO_COLOR`, and limited dimensions. Real SSH and visual checks remain a separate manual acceptance entry with sanitized evidence; no actual host mutation is needed to verify prompt behavior.

## Risks / Trade-offs

- Prompt libraries and existing readline/raw-mode handlers may compete for stdin. Mitigation: one prompt adapter owns input; remove superseded handlers from rich flows and centralize cancellation cleanup.
- A library update may exceed Node.js 22 support or fail bundling. Mitigation: lock a compatible release and test the distributed executable before flow integration.
- ANSI output or a spinner can corrupt JSON or protected files. Mitigation: output-policy tests and separate structured/protected output sinks.
- Terminal labels may contain control characters or exceed available dimensions. Mitigation: sanitize rendering, use bounded list pagination, and test small terminals and Unicode.
- Confirmation can be mistaken for rollback. Mitigation: guarantee zero mutation before approval; preserve existing error/recovery semantics after apply starts.
- Browser import is unavailable without retained credentials. Mitigation: explain the requirement and keep `--keep` explicit; no automatic rotation.

## Migration Plan

No data, credential, bucket, or deployed-state migration. Ship through the ordinary CLI source build/install workflow after local and packaged checks. Update CLI usage/help with new entry points and compatibility rules. Operators choose when to install and use the updated CLI. Reverting the CLI source/package restores prior presentation without migrating managed resources; already confirmed host changes remain governed by existing lifecycle operations.
