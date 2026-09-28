## ADDED Requirements

### Requirement: Guided vault creation
`fos vault add` SHALL collect a missing vault ID in an interactive terminal, validate it using existing identifier and collision rules, resolve the WSS endpoint using existing precedence, and preflight administrator access and existing bucket/user state before prompting for an optional QR encryption phrase or mutating resources. It SHALL display a secret-free creation review identifying the vault, endpoint, retention choice, and handoff destination, then require confirmation defaulting to cancellation. Supplied flags SHALL retain their existing meaning, and `--keep` SHALL remain the explicit authorization to retain a generated vault plaintext credential. Confirmed creation SHALL use the existing isolated-vault provisioning, verification, and protected handoff contracts. Missing values in unattended execution SHALL fail without prompting. Supported JSON output SHALL suppress terminal handoff disclosure and require an explicit protected secret destination before creation.

#### Scenario: Add without a vault ID
- **WHEN** an operator runs `fos vault add` without `--vault-id` in an interactive terminal
- **THEN** the CLI collects and validates the ID, preflights access and existing state, reviews the choices, and creates the vault only after confirmation

#### Scenario: Invalid entered identifier
- **WHEN** an operator enters an invalid vault ID
- **THEN** the CLI requests a corrected ID before mutation without discarding previously accepted inputs

#### Scenario: Existing vault or identifier collision
- **WHEN** the requested ID already has a managed user or conflicts with an existing normalized bucket or username
- **THEN** the CLI reports the existing condition according to current administration contracts without resetting content, rotating credentials, or prompting for a new handoff phrase

#### Scenario: Administrator access fails
- **WHEN** administrator authentication or the required preflight fails
- **THEN** the CLI reports the failure before handoff-phrase collection and before changing buckets or users

#### Scenario: Creation declined
- **WHEN** an operator declines creation or accepts the cancellation default
- **THEN** the CLI creates no bucket, user, credential record, or handoff file

#### Scenario: Explicit output and retention
- **WHEN** an operator confirms creation with `--secrets-output` and without `--keep`
- **THEN** the CLI writes the verified handoff only to the protected destination and retains no vault plaintext credential

#### Scenario: Unattended creation
- **WHEN** an operator runs the existing fully specified unattended vault-add command
- **THEN** the CLI preserves its existing validation and provisioning behavior without new interactive confirmation, and missing required values fail before mutation

#### Scenario: JSON creation without a protected destination
- **WHEN** an operator requests JSON for vault creation without `--secrets-output`
- **THEN** the CLI fails before mutation without emitting secrets or interactive prompts

### Requirement: Interactive vault browser
`fos vault` with no action SHALL open a vault browser only in an interactive terminal. `fos vault list --interactive` SHALL open the same browser. The browser SHALL resolve managed mode and authenticate through existing protected administrator inputs, list vault IDs with storage/history/replica metadata, and allow keyboard selection of a vault or an Add new vault action. Selecting a vault SHALL offer inspection and the existing local import handoff flow, plus Back and Exit. It SHALL NOT present rotation, revocation, or deletion actions. Creation SHALL use the guided vault-add flow. Import SHALL require an existing retained vault credential and SHALL not create or rotate a credential to compensate for its absence. Bare-action `fos vault` SHALL accept `--mode`, `--admin-input`, `--secrets-output`, `--wss-endpoint`, and `--keep`; output and endpoint overrides SHALL apply to creation/import and `--keep` SHALL apply only to creation. Unknown options and bare-action `--json` SHALL fail before service access. After an action completes, the browser SHALL refresh the list before allowing another selection; Exit SHALL terminate successfully without mutation.

#### Scenario: Browse existing vaults
- **WHEN** an operator runs `fos vault` in an interactive terminal on a configured installation
- **THEN** the CLI authenticates the administrator and displays a keyboard-selectable vault list with an Add new vault action

#### Scenario: Inspect selected vault
- **WHEN** an operator selects an existing vault and chooses inspection
- **THEN** the CLI displays that vault's current bucket metadata without changing its data or authorization

#### Scenario: Import retained credential
- **WHEN** an operator selects import for a vault with a retained credential
- **THEN** the CLI uses the existing protected import flow and excludes administrator credentials from the URI and QR code

#### Scenario: Import unavailable
- **WHEN** a selected vault has no retained plaintext credential
- **THEN** the browser explains that import is unavailable and neither rotates credentials nor changes retention

#### Scenario: Protected browser handoff
- **WHEN** an operator opens `fos vault --secrets-output PATH` and selects creation or import
- **THEN** the CLI writes the handoff only to the selected protected path without terminal secret disclosure

#### Scenario: Empty vault list
- **WHEN** no vaults exist
- **THEN** the browser displays that state and offers Add new vault and Exit without failing or selecting an absent vault

#### Scenario: Return after creation
- **WHEN** guided creation finishes within the browser
- **THEN** the browser refreshes the list and displays the new vault only if provisioning succeeds

#### Scenario: Stale selection
- **WHEN** a selected vault is no longer present when its action runs
- **THEN** the browser reports the changed state and refreshes the list without recreating the vault

#### Scenario: Plain terminal browser
- **WHEN** an operator opens the browser with terminal input and output and `TERM=dumb`
- **THEN** the same choices are available through numbered plain prompts without terminal control sequences

### Requirement: Vault command output compatibility
`fos vault list` SHALL remain a finite listing command, using a human-readable table on a terminal and JSON when redirected or explicitly requested. It SHALL NOT open the browser implicitly. Supported `--json` requests SHALL disable interactive collection. `--interactive` SHALL be supported only on `vault list`, SHALL require terminal input and output, and SHALL be rejected with `--json` before service access. `fos vault --help` SHALL remain help-only; bare `fos vault` without terminal input and output SHALL display command help without service access or mutation. Existing explicit vault subcommands SHALL remain available.

#### Scenario: Ordinary listing
- **WHEN** an operator runs `fos vault list` in a terminal without `--interactive`
- **THEN** the CLI displays the listing and exits without a selection prompt

#### Scenario: Structured listing
- **WHEN** an operator redirects `fos vault list` or supplies `--json` with valid administrator access
- **THEN** the CLI emits the existing JSON result without prompts, spinners, terminal escapes, or handoff disclosure

#### Scenario: Conflicting browser flags
- **WHEN** an operator combines `fos vault list --interactive` and `--json`
- **THEN** the CLI rejects the incompatible flags before authenticating or contacting services

#### Scenario: Browser requested without a terminal
- **WHEN** an operator runs `fos vault list --interactive` with redirected input or output
- **THEN** the CLI reports that an interactive terminal is required without service access or mutation

#### Scenario: Help outside a terminal
- **WHEN** an operator runs bare `fos vault` without terminal input and output, or requests `fos vault --help`
- **THEN** the CLI displays vault command help without authenticating, accessing services, or mutating resources
