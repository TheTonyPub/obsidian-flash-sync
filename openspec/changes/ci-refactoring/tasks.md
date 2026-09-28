## 1. Tag and source contracts

One implementation owner carries tests, code, and related documentation through each section; task metadata does not require separate agents.

Model routing:

- `gpt-6-sol` with `medium`: default owner for architecture, implementation, tests, documentation, verification, and final review.
- `gpt-6-luna` with `medium`: bounded exploration, test design, routine verification, and documentation when delegation has a clear benefit.
- `gpt-6-luna` with `high`: bounded implementation, including its tests and related documentation, when delegation has a clear benefit.

Keep implementation with the primary Sol/medium owner when it can complete the work. Delegate only for a concrete benefit, such as independent work that reduces total cost or elapsed time; a cheaper available model or task label alone is not a reason to delegate. Keep one implementation owner per coherent feature; reuse that owner across tests, code, and documentation. Do not create agents per checkbox or TDD phase. Model choices belong in Codex configuration and agent profiles; this plan does not switch the active model.

- [x] 1.1 Extend existing disposable Git fixture tests to fail for the new contracts: optional rc tags, candidate builds from dev or matching release branch, publication only from matching release branch, development publication rejection, strict numeric forms, explicit tag selection, and stable/candidate exact-SHA and base-version equality. [Owner: implementation owner; test design]
- [x] 1.2 Refactor existing tag/reachability helpers to implement distinct build and publication eligibility; preserve source-manifest base version and plugin identity checks without creating a parallel parser. [Owner: implementation owner; implementation]
- [x] 1.3 Run focused release tests and demonstrate that branch creation enables promotion of the same existing candidate tag, multiple branch-contained tags cannot change selection, and release-only fixes do not require an early dev merge. [Owner: implementation owner; implementation]

## 2. Verified installation artifacts

- [x] 2.1 Add failing tests for versioned build metadata, explicit run/attempt identity, required file hashes, allowed installation paths, optional stylesheets, tampered files, wrong manifests, and missing content. Reuse current fixture helpers. [Owner: implementation owner; test design]
- [x] 2.2 Extend existing packaging/verification tooling to produce install files and a separate metadata envelope recording source, build inputs, run/attempt, and hashes; never include metadata among public installation assets. [Owner: implementation owner; implementation]
- [x] 2.3 Add failing tests and implement stable metadata promotion: candidate/stable same SHA and base version, unchanged JavaScript/CSS and other manifest fields, exact destination manifest version, and no compiler invocation. [Owner: implementation owner; implementation]
- [x] 2.4 Verify artifact layout and original source-manifest preservation; run focused release tests and record original/final file hashes for candidate and stable fixture outputs. [Owner: implementation owner; implementation]

## 3. Build workflow separation

- [x] 3.1 Inventory existing triggers, check commands, coverage outputs, badge conditions, and permissions. Add focused workflow validation covering tag validation before compilation, one candidate compilation, artifact upload only after required checks, release-branch checks, and stable tag handling without compilation/publication. [Owner: implementation owner; test design]
- [x] 3.2 Refactor ci.yml to retain PR/dev/master checks, add release branch checks, build/package development and candidate tags once, and remove the automatic GitHub release job. Preserve unit, CLI bundle, integration, Docker-backed NATS/MinIO, simulation, aggregate coverage, and dev/master badge behavior. [Owner: implementation owner; implementation]
- [x] 3.3 Upload verified installation artifacts with attempt-specific identity and explicit retention bounded by repository policy; retain diagnostic coverage uploads on failed checks without uploading successful installation artifacts. Stable tag events validate and show publication instructions only. [Owner: implementation owner; implementation]
- [x] 3.4 Validate workflow syntax with available workflow tooling and compare final trigger/job/check inventory against the baseline. Record any unavailable validator or platform-only check as unverified. [Owner: implementation owner; implementation]

## 4. Explicit publication and recovery

- [x] 4.1 Add failing local GitHub API fixture tests for successful promotion and rejection of wrong repository/workflow/event/tag/SHA/run/attempt/artifact, unsuccessful or incomplete checks, expired/deleted artifacts, corruption, unsafe paths, and untrusted dispatch refs. Assert zero release mutations and zero compilation for rejected requests. [Owner: implementation owner; test design]
- [x] 4.2 Implement strict dispatch input and authoritative GitHub run/artifact validation using trusted default-branch helper code; verify source and branch eligibility, archive/file hashes, and candidate or stable installation package before release mutation. Do not execute artifact code or tagged-source dependency hooks. [Owner: implementation owner; implementation]
- [x] 4.3 Add failing tests and implement draft-first creation, full asset verification before publish, correct prerelease/latest flags, matching interrupted-draft recovery, no-op completed retries, and preserved conflicts without overwriting/deleting/retagging. [Owner: implementation owner; implementation]
- [x] 4.4 Add plugin-publish.yml with explicit tag/source_tag/build_run_id/build_run_attempt/artifact_id inputs, default-branch dispatch guard, per-tag non-cancelling concurrency, job-scoped actions:read and contents:write permissions, and reviewed SHA pins for newly introduced actions. Do not add automatic release-event chains. [Owner: implementation owner; implementation]
- [x] 4.5 Exercise development, initial candidate, branch creation, candidate fix, prerelease, stable promotion, failed checks, expiry, conflicting release, and repeat publication in disposable Git/API fixtures. Verify publisher never runs npm install/build and does not substitute another artifact. [Owner: implementation owner; implementation]

## 5. Contributor and agent documentation

- [x] 5.1 Create root CONTRIBUTION.md with Node/npm setup, real plugin/CLI build and test commands, feature PRs into dev, stabilization fixes, exact tag/run/attempt/artifact promotion, stable source identity, retention/failure/retry handling, integration of fixes into dev, and branch retirement. Include one Mermaid release-cycle diagram. [Owner: implementation owner; implementation]
- [x] 5.2 Create root AGENTS.md targeting 80-120 lines: plugin/protocol/CLI repository map, NATS/WSS and IndexedDB/outbox concepts, stable identity/CAS/tombstone/conflict invariants, optional S3, vault and credential isolation, concise discovery/TDD/check instructions, and branch/release rules. Link detailed references; avoid personal paths, fixed model assignments, and duplicated CLI option tables. [Owner: implementation owner; implementation]
- [x] 5.3 Update README links, release installation instructions, candidate/stable badge descriptions, and branding references to match actual behavior; keep fos source installation distinct from plugin Releases and retain existing NATS/CLI guides. [Owner: implementation owner; implementation]
- [x] 5.4 Manually follow contributor examples against disposable fixtures, verify document links and command names, check AGENTS scope/length, and render or inspect the release diagram with available tooling. Fix contradictory instructions without adding a documentation-only test framework. [Owner: implementation owner; implementation]

## 6. Integration acceptance and evidence

- [x] 6.1 Run focused release/publication tests, then relevant typecheck, lint, unit, plugin build, CLI bundle, integration, simulation, and disposable NATS/MinIO checks. Use one complete relevant verification pass; repeat only for new edits or unresolved failures. Record exact commands and results. [Owner: implementation owner; implementation]
- [x] 6.2 Review all modified requirement scenarios against executed fixtures and workflow checks. Verify no plugin data/protocol/credential behavior changes and preserve existing user-owned infrastructure boundaries. [Owner: implementation owner; implementation]
- [x] 6.3 Validate the OpenSpec change strictly and check whitespace and artifact completeness. Create acceptance-evidence.md during implementation with scenario coverage, check results, fixture hashes, documentation/diagram evidence, and remaining platform limitations. [Owner: implementation owner; implementation]
- [x] 6.4 Verify or document required workflow availability on the repository default branch, Actions artifact retention, and owner-controlled tag/branch/immutability configuration. Do not merge branches, alter GitHub settings, or create live tags/releases without explicit authorization; mark live publication unverified until separately exercised. [Owner: implementation owner; implementation]

## 7. Authorized live prerelease acceptance

The owner authorized live testing without a stable release after local acceptance.

- [ ] 7.1 Integrate the verified CI change into default `dev` through a pull request after successful GitHub checks; record the PR and resulting commit.
- [ ] 7.2 Create a non-conflicting candidate tag, verify its full CI and exact installation artifact, and establish the matching release branch at the same commit.
- [ ] 7.3 Dispatch candidate publication with exact run/attempt/artifact inputs; verify prerelease status, complete assets and unchanged latest stable release, then repeat the same request to prove no mutation.
- [ ] 7.4 Download published installation assets, compare all hashes against the selected CI artifact, and record live run/release evidence and remaining unverified stable/immutability behavior.
