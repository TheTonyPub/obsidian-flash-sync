## 1. Prompt foundation and compatibility policy

- [x] 1.1 Add failing tests for terminal policy: both TTY streams required, unattended/JSON suppression, `NO_COLOR` keyboard support, plain `TERM=dumb` fallback, and help without service access.
- [x] 1.2 Define injected typed select/input/password/confirm contracts and shared validators; add a Node.js 22-compatible locked `@inquirer/prompts` dependency and prove it bundles with the existing server CLI build.
- [x] 1.3 Implement rich and plain prompt adapters, unified Ctrl+C cleanup with exit 130, display-label sanitization, and bounded list rendering; remove superseded raw-input ownership from migrated flows.
- [x] 1.4 Make policy tests pass and add focused adapter checks for arrow/Enter selection, defaults, field correction, secret non-echo, and terminal cleanup.

## 2. Guided bootstrap

- [x] 2.1 Add failing bootstrap tests for installation descriptions, field correction, optional email validation, explicit flag precedence, invalid supplied fields, host-option choices, and cancellation with zero writes.
- [x] 2.2 Replace string-question detection with typed bootstrap prompts; reuse existing plan/apply/state logic and display the highlighted redacted plan before confirmation defaulting to cancellation.
- [x] 2.3 Verify interactive `--approve` still requires confirmation, explicit `--secrets-output` suppresses terminal secrets, and the existing unattended input/approval flow remains prompt-free.

## 3. Guided vault creation

- [x] 3.1 Add failing tests for missing/invalid ID prompts, administrator and bucket/user/collision preflight before phrase collection, existing-user behavior, review contents, and no bucket/user/store/output writes before confirmation.
- [x] 3.2 Implement guided collection and review within existing vault orchestration; after confirmation, compose existing bucket creation/inspection and user addition, then reuse own-bucket verification and protected handoff delivery.
- [x] 3.3 Verify `--keep` alone controls retention, endpoint/output overrides retain precedence, existing content survives, preflight races do not rotate/reset credentials, and partial failures are reported without claiming success or deleting pre-existing data.
- [x] 3.4 Cover fully specified unattended add and missing-value failures; require protected output for supported JSON creation and prove no prompts or secret contamination.

## 4. Interactive vault browser

- [x] 4.1 Add failing tests for bare `fos vault` terminal/help dispatch, explicit `vault list --interactive`, exact accepted browser flags, JSON conflicts, and non-terminal rejection before service access.
- [x] 4.2 Implement browser listing and selection using existing mode/admin adapters; offer Inspect, Import, Add new vault, Back, and Exit without destructive menus.
- [x] 4.3 Reuse guided add and local import orchestration; honor explicit browser output/endpoint/retention options, explain unavailable retained credentials, refresh after actions, and handle empty/stale lists without mutation.
- [x] 4.4 Verify ordinary terminal listing remains finite, redirected/explicit JSON listing remains machine-readable, and browser Ctrl+C exits rather than restarting a menu.

## 5. Documentation and acceptance

- [x] 5.1 Update CLI help and `docs/fos-usage.md` with bootstrap prompts, both browser entry points, exact options, import retention limits, protected output, plain fallback, and automation examples.
- [x] 5.2 Add and run packaged executable checks for prompt dependency loading, help, flag errors, table/JSON separation, and protected UTF-8 handoff output without ANSI; use disposable fixtures only.
- [x] 5.3 Run a disposable pseudo-terminal acceptance harness for arrows/Enter, Ctrl+C status 130, input/cursor restoration, secret non-echo, `NO_COLOR`, `TERM=dumb`, Unicode labels, long lists, and narrow dimensions. Record manual visual/SSH-shell checks separately; do not mutate actual services for UI acceptance.
- [x] 5.4 Run focused CLI tests, then typecheck, lint, CLI build, unit suite, and server CLI bundle tests. Run relevant disposable NATS/Compose checks for changed creation sequencing where the required local runtime is available; record unavailable checks rather than claiming runtime acceptance.
- [x] 5.5 Record sanitized acceptance evidence mapping both delta specs to executed checks, review the final diff for preserved credential/authorization boundaries, and validate the OpenSpec change strictly. Do not publish, deploy, sync main specs, or archive without separate authorization.
