# vault-provisioning Specification

## Purpose

Defines administrator-only creation and maintenance of isolated NATS KV vaults and credentials while protecting existing vault content.

## Requirements

### Requirement: Provision isolated vault
The CLI SHALL create or inspect a distinct `OBS_<vaultId>_FILES` JetStream KV bucket and dedicated NATS username/password per vault, using file storage, history 10, and replicas 1 initially. It SHALL generate each new vault password with cryptographically secure randomness and at least 128 bits of entropy. Plugin users SHALL have only the NATS subjects needed for their own KV operations; they SHALL NOT have bucket-administration rights. After successful creation and verification, it SHALL disclose a vault-only Obsidian import URI and terminal QR code containing the WSS endpoint and connection configuration. `--wss-endpoint` SHALL override the managed bootstrap endpoint only after URL validation; when neither is available, an interactive command SHALL request an endpoint and unattended execution SHALL fail before mutation.

#### Scenario: New vault
- **WHEN** an authorized operator creates a new vault ID
- **THEN** the CLI provisions the matching bucket and scoped user, verifies that user's own-bucket operations, produces an import URI and QR code using the resolved WSS URL, and discloses the new random password once through protected output after verification succeeds

#### Scenario: Existing vault
- **WHEN** an operator repeats creation for an existing vault ID
- **THEN** the CLI detects the existing bucket and user without resetting content or silently rotating the password

#### Scenario: Conflicting identifier
- **WHEN** different vault IDs would normalize to the same bucket or username
- **THEN** the CLI rejects the collision before modifying NATS

#### Scenario: No endpoint for unattended creation
- **WHEN** an unattended vault-user creation has no valid managed endpoint and omits `--wss-endpoint`
- **THEN** the CLI refuses before creating or rotating a vault credential

### Requirement: Administrator identity and protected secret handoff
Bootstrap SHALL generate a separate NATS administrator password with cryptographically secure randomness and at least 128 bits of entropy. The administrator identity SHALL be required for subsequent KV bucket and vault-user management, including creation, listing, inspection, rotation, and revocation. The CLI SHALL disclose generated administrator and first-vault credentials once after successful installation through protected output, never in plans, logs, command arguments, or world-readable files. An explicitly selected `--secrets-output` destination SHALL take precedence over terminal disclosure. Bootstrap SHALL always retain the administrator credential in its separate protected local record; it SHALL retain the first-vault plaintext credential only with `--keep`. Administrator credentials SHALL NOT be placed in plugin settings, import URIs, or QR codes.

#### Scenario: Successful interactive bootstrap
- **WHEN** installation and verification complete in an interactive terminal
- **THEN** the CLI displays the administrator and first-vault credentials once with their distinct purposes identified, and displays the vault-only import URI and QR code unless `--secrets-output` was selected, in which case it writes the handoff there without credential disclosure to the terminal

#### Scenario: Successful noninteractive bootstrap
- **WHEN** unattended installation and verification complete
- **THEN** the CLI writes generated credentials only to an explicitly selected owner-readable destination and does not print them into general automation logs

#### Scenario: Missing administrator credential later
- **WHEN** an operator invokes a KV management command without valid administrator credentials
- **THEN** the command refuses the operation before changing any bucket or user

#### Scenario: Repeated bootstrap
- **WHEN** bootstrap is repeated for an existing installation
- **THEN** it neither regenerates nor redisplays existing passwords

### Requirement: Credential lifecycle
The CLI SHALL provide list, credential rotation, and revocation operations for vault users. It SHALL generate replacement passwords with cryptographically secure randomness and at least 128 bits of entropy, accept administrator secret input without echo or command-line argument leakage, avoid plaintext secret logs and world-readable files, and never grant administrator credentials to the plugin. Vault-user add and rotation SHALL honor `--keep` for the newly generated credential only; without it they SHALL produce a one-time import URI and QR code but retain no vault plaintext password. Revocation SHALL remove any retained record for that vault so it cannot be imported again. Rotation SHALL replace any retained record only after the replacement server credential is verified.

#### Scenario: List vaults without an identifier
- **WHEN** an operator runs `fos vault list` on a configured installation without a vault ID
- **THEN** the CLI resolves the managed installation mode, authenticates the administrator, and lists vaults without requiring `--vault-id`

#### Scenario: Rotate one vault password
- **WHEN** an operator rotates a vault credential
- **THEN** the CLI updates only that vault's credential, reports a verified replacement connection while preserving bucket contents, and emits a new vault-only import URI and QR code

#### Scenario: Rotate a retained vault
- **WHEN** an operator rotates a retained vault credential with `--keep`
- **THEN** the CLI replaces the stored plaintext only after verification succeeds and the preceding handoff no longer authenticates

#### Scenario: Revoke one vault user
- **WHEN** an operator confirms revocation
- **THEN** new connections with that user's old credentials are rejected, its retained credential is removed, and other vault users remain usable

### Requirement: Safe managed authorization updates
The CLI SHALL update managed NATS authorization without losing the prior valid configuration if validation, writing, or service update fails. In container modes, it SHALL make the updated authorization available to NATS while preserving persistent vault data and other services; connected clients may briefly reconnect. Native mode SHALL reload the updated authorization.

#### Scenario: Container authorization update
- **WHEN** an operator adds, rotates, or revokes a vault credential in Docker or Podman mode
- **THEN** the CLI atomically updates authorization, makes NATS use the new file, preserves bucket data and Caddy, and restores the prior authorization if the update fails

#### Scenario: Native authorization update
- **WHEN** an operator adds, rotates, or revokes a vault credential in native mode
- **THEN** the CLI reloads NATS with the validated authorization while preserving bucket data

### Requirement: Protected local credential store
The CLI SHALL maintain its fixed managed credential store in a root-owned location with mode `0600`, and SHALL write replacements atomically. It SHALL store administrator credentials separately from vault records and SHALL retain a vault plaintext credential only after an explicit `--keep`. It SHALL not include plaintext credentials in plans, ordinary logs, command arguments, or unattended standard output.

#### Scenario: Bootstrap retention
- **WHEN** bootstrap completes successfully
- **THEN** the CLI persists the administrator credential in its separate protected record and persists the first vault credential only when `--keep` was supplied

#### Scenario: Later vault-user retention
- **WHEN** `fos vault add` or rotation completes with `--keep`
- **THEN** the CLI atomically stores only that vault's newly generated credential in the protected vault-record area

#### Scenario: One-time vault handoff
- **WHEN** bootstrap or vault-user creation completes without `--keep`
- **THEN** the CLI delivers the import URI and QR code once through the selected protected output but retains no plaintext vault credential for later import

### Requirement: Protected bootstrap recovery output
When `--secrets-output` is explicitly supplied, the CLI SHALL write generated bootstrap credentials to that protected destination even in an interactive terminal, and SHALL not disclose those credentials to terminal output. If managed-state or credential-record persistence fails after services are applied, the CLI SHALL attempt to deliver credentials through the selected protected output and SHALL preserve the original failure as the reported error.

#### Scenario: Interactive bootstrap with explicit protected output
- **WHEN** an operator runs bootstrap in a terminal and supplies `--secrets-output`
- **THEN** the CLI atomically writes the credential handoff to the owner-readable protected destination and suppresses credential disclosure to the terminal

#### Scenario: Bootstrap persistence failure
- **WHEN** service application succeeds but managed-state or protected credential-record persistence fails
- **THEN** the CLI attempts credential delivery through the selected output and reports the persistence failure even if recovery delivery also fails

### Requirement: Verify access boundaries
The CLI SHALL verify each provisioned user's own-bucket operations before successful bootstrap and credential handoff. It SHALL report own-bucket verification separately from cross-vault verification. A cross-vault check SHALL require an explicitly identified, already-provisioned peer vault and protected administrator authentication to confirm that peer exists; only an actual permission denial against the peer counts as success. A missing peer or timeout SHALL not count as denial. The CLI SHALL also verify unauthenticated access denial and report failures without deleting local/remote vault data.

#### Scenario: First vault has no peer
- **WHEN** bootstrap provisions the first vault on an otherwise empty NATS server
- **THEN** it verifies that user's own-bucket status, watch, write, and read before disclosing credentials, and reports cross-vault isolation as not yet tested

#### Scenario: Two-vault isolation
- **WHEN** two vaults are provisioned on one NATS instance and the operator identifies the peer vault for verification
- **THEN** each user can perform its own KV read, write, watch, and status operations, while read/write/watch against the other vault is denied

#### Scenario: Unauthenticated client
- **WHEN** a client connects without credentials or with an incorrect password
- **THEN** no vault data can be accessed

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
