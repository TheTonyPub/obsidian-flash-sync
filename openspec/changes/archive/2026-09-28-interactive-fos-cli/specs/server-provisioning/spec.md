## MODIFIED Requirements

### Requirement: Clear terminal and machine-readable output
The CLI SHALL provide command-specific help for root commands and nested vault actions. It SHALL use color only for interactive terminal output when color is enabled, and SHALL preserve plain text or explicitly requested JSON output when redirected or when color is disabled. Interactive choices SHALL explain available options and accept keyboard selection; output SHALL identify errors and relevant paths clearly. Rich prompts SHALL require both terminal input and terminal output and a terminal other than `TERM=dumb`. `NO_COLOR` SHALL disable color without disabling keyboard selection. Plain interactive prompts SHALL remain available for `TERM=dumb`. Redirected output, unattended execution, and supported `--json` requests SHALL NOT enter an interactive browser or emit prompt redraws, spinners, or color escapes. Help SHALL take precedence over interactive entry points.

#### Scenario: Command-specific help
- **WHEN** an operator requests help for a command or nested vault action
- **THEN** the CLI prints that command's usage, options, and examples, then exits without contacting a service or changing the host

#### Scenario: Redirected output
- **WHEN** an operator redirects human-readable command output or requests JSON
- **THEN** terminal color escapes are omitted and JSON output remains valid machine-readable JSON

#### Scenario: Color disabled on a capable terminal
- **WHEN** an operator uses an interactive terminal with `NO_COLOR` set
- **THEN** selection remains keyboard-driven and no color escapes are emitted

#### Scenario: Plain interactive fallback
- **WHEN** both input and output are terminals but `TERM=dumb`
- **THEN** the CLI uses numbered choices and plain text questions without cursor movement, colors, or animated progress

#### Scenario: Missing values outside an interactive terminal
- **WHEN** required values are missing and input or output is redirected, unattended mode is selected, or supported JSON output is requested
- **THEN** the CLI fails clearly without waiting for terminal input or changing resources

## ADDED Requirements

### Requirement: Consistent terminal prompts
Interactive bootstrap and guided vault management SHALL present consistent selection, text, secret, and confirmation prompts. Selection SHALL accept up/down arrows and Enter, display the selected option distinctly, and explain available choices. Text prompts SHALL validate operator input and allow correction at the field that failed. Secret prompts SHALL not echo secret values. Confirmation before mutation SHALL default to cancellation. Ctrl+C SHALL restore terminal input and cursor state and exit with status 130; cancellation before confirmation SHALL leave resources unchanged. Terminal rendering SHALL sanitize untrusted display labels and keep the selected option visible within the available terminal width and height.

#### Scenario: Keyboard selection
- **WHEN** an operator moves through a selection using arrow keys and presses Enter
- **THEN** the CLI accepts the highlighted option and displays the completed choice

#### Scenario: Invalid field
- **WHEN** an operator enters an invalid required value
- **THEN** the CLI explains the field error and requests correction without losing previously accepted fields or mutating resources

#### Scenario: Secret input
- **WHEN** an operator enters an administrator password or optional QR encryption phrase
- **THEN** the CLI accepts the value without echoing it or placing it in the completed prompt history

#### Scenario: Default cancellation
- **WHEN** an operator presses Enter at a mutation confirmation without changing its default
- **THEN** the CLI cancels the operation without mutation

#### Scenario: Interrupted prompt
- **WHEN** an operator presses Ctrl+C during a prompt or unconfirmed plan
- **THEN** the CLI restores terminal input and cursor state, exits with status 130, and does not apply the unconfirmed operation

#### Scenario: Narrow terminal and untrusted labels
- **WHEN** a selection contains more options than visible terminal rows or labels with terminal control characters
- **THEN** the selected option remains visible, labels cannot inject terminal controls, and navigation remains usable

### Requirement: Guided bootstrap fields and review
Interactive `fos bootstrap` SHALL collect missing installation mode, endpoint domain, ACME email, and initial vault ID through consistent prompts. Installation choices SHALL describe native services, Docker Compose, and Podman Compose. Domain and vault ID input SHALL satisfy the existing bootstrap validation rules; ACME email SHALL accept an empty value or a valid email address. The flow SHALL offer the existing firewall and dedicated-service-account choices with explanatory text. Explicit valid flags SHALL supply their values without redundant collection; invalid supplied values SHALL fail before mutation rather than being silently replaced. Bootstrap SHALL display the existing redacted plan with visually distinct configuration, paths, services, and access/recovery information, then require explicit confirmation before apply, including when `--approve` is supplied in interactive mode. Existing unattended bootstrap inputs and protected output requirements SHALL remain supported.

#### Scenario: Guided first installation
- **WHEN** an operator starts `fos bootstrap` without configuration flags in an interactive terminal
- **THEN** the CLI collects and validates the missing fields, presents the optional host choices, displays the redacted plan, and applies only after explicit confirmation

#### Scenario: Supplied bootstrap fields
- **WHEN** an operator supplies valid mode, domain, email, or vault ID flags
- **THEN** the CLI uses those values without asking for them again and includes the resolved configuration in the review

#### Scenario: Invalid supplied field
- **WHEN** an operator supplies an invalid bootstrap field through a flag
- **THEN** the CLI reports the invalid field before mutation and does not silently substitute an interactive answer

#### Scenario: Interactive approval flag
- **WHEN** an operator supplies `--approve` to an interactive bootstrap
- **THEN** the CLI still displays the plan and requires an affirmative confirmation

#### Scenario: Unattended compatibility
- **WHEN** an operator supplies the existing valid unattended bootstrap input, protected secret destination, and approval
- **THEN** the CLI uses the same provisioning behavior without interactive prompts or terminal animation

#### Scenario: Protected bootstrap output
- **WHEN** an operator supplies `--secrets-output` during guided bootstrap
- **THEN** the CLI writes the handoff to that protected destination and does not echo its secrets into terminal prompt history or ordinary output
