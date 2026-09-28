## MODIFIED Requirements

### Requirement: Tag channels and source branches
The repository SHALL recognize `x.y.z` as stable, `x.y.z-alpha.N`, `x.y.z-beta.N`, and `x.y.z-rc.N` as candidate versions, and `x.y.z-dev.N` as development, where all numeric components are nonnegative SemVer integers without leading zeroes and `N` is positive. Development builds SHALL require commits reachable from `dev`. Candidate builds SHALL require commits reachable from `dev` or the matching `release/x.y.z` branch. Candidate publication SHALL additionally require reachability from that matching release branch. Stable publication SHALL require a stable tag reachable from `master` and pointing to the exact same commit as the selected verified candidate of the same base version. Channel classification SHALL use the explicit tag, not inferred branch origin. Invalid or mismatched inputs SHALL fail before installation artifact upload or publication.

#### Scenario: Development tag
- **WHEN** `1.3.0-dev.7` points to a commit reachable from `dev`
- **THEN** CI accepts it only as a development artifact build

#### Scenario: Prerelease tag
- **WHEN** a valid `1.3.0-alpha.2` or `1.3.0-beta.2` tag points to a commit reachable from `dev`
- **THEN** CI accepts it as a candidate artifact build and requires explicit promotion for GitHub prerelease publication

#### Scenario: Candidate before stabilization
- **WHEN** `1.3.0-beta.2` points to a commit reachable from `dev` and no matching release branch exists
- **THEN** CI can build a candidate artifact but SHALL NOT publish a GitHub Release

#### Scenario: Candidate fix on release branch
- **WHEN** `1.3.0-rc.1` points to a commit reachable from `release/1.3.0` but not yet from `dev`
- **THEN** CI accepts the candidate build without requiring the fix to merge into `dev` first

#### Scenario: Same tag promoted after branch creation
- **WHEN** `release/1.3.0` is created at the commit of a successfully built `1.3.0-beta.2` tag
- **THEN** an explicit publication request can promote that tag's existing artifact without rebuilding or moving the tag

#### Scenario: Branch contains multiple tags
- **WHEN** the release branch contains several candidate tags
- **THEN** publication selects only the explicitly requested tag and SHALL NOT choose a tag by ordering, branch membership alone, or latest successful run

#### Scenario: Stable tag
- **WHEN** `1.3.0` and selected verified `1.3.0-beta.2` resolve to the same commit reachable from `master`
- **THEN** CI accepts stable publication without compiling the plugin again

#### Scenario: Wrong branch or malformed tag
- **WHEN** a tag is malformed, lacks required branch reachability, uses a different base version, or stable and candidate tags resolve to different commits
- **THEN** the request fails without publishing installation files

### Requirement: Manifest version matches build
Each tagged installation artifact and published release SHALL contain a plugin manifest whose version equals its destination tag text exactly. Plugin ID and display name SHALL be `flash-sync`. JavaScript SHALL come from the verified build of the destination tag's exact commit. Prerelease promotion SHALL preserve every installation file byte for byte. Stable promotion SHALL reuse the candidate JavaScript and optional stylesheet unchanged, change only the manifest version to the stable tag, and verify the resulting installation package without compilation.

#### Scenario: Versioned prerelease build
- **WHEN** `1.3.0-beta.11` is built
- **THEN** its installation manifest has version `1.3.0-beta.11`, ID and name `flash-sync`, and accompanies that commit's JavaScript

#### Scenario: Candidate publication preserves files
- **WHEN** verified `1.3.0-beta.11` artifact is promoted
- **THEN** release installation file hashes equal the selected artifact file hashes

#### Scenario: Stable metadata promotion
- **WHEN** stable `1.3.0` promotes a verified candidate from the same commit
- **THEN** the manifest version becomes `1.3.0`, all other manifest fields remain unchanged, and JavaScript and optional stylesheet hashes remain equal to the candidate hashes

#### Scenario: Inconsistent installation package
- **WHEN** installation files have the wrong version, identity, missing required content, or unexpected file names
- **THEN** verification fails and publication does not occur

### Requirement: Minimal installable outputs
Stable and prerelease GitHub Releases SHALL attach `main.js` and `manifest.json` as explicit installation assets, and `styles.css` only when used. They SHALL NOT upload duplicate source archives or internal build metadata as installation assets. Development and candidate tag builds SHALL create downloadable CI artifacts after validation, build, and required tests, and SHALL NOT automatically create GitHub Releases. Stable tag handling SHALL NOT compile the plugin or automatically publish. Only explicit, verified publication SHALL create GitHub Releases. Candidate releases SHALL be marked prerelease and SHALL NOT be latest; stable releases SHALL not be marked prerelease and SHALL be latest. Creating or updating a release branch SHALL NOT itself publish a release.

#### Scenario: Candidate tag push
- **WHEN** an alpha, beta, or release-candidate tagged build passes required checks
- **THEN** installation files are available as a CI artifact and no GitHub Release is created

#### Scenario: Stable publication
- **WHEN** explicit stable promotion passes verification
- **THEN** a stable GitHub Release provides `main.js` and `manifest.json`, optional stylesheet when used, and GitHub-generated source archives, and is marked latest

#### Scenario: Prerelease publication
- **WHEN** explicit candidate promotion passes verification
- **THEN** a GitHub prerelease provides the same minimal installation assets and GitHub-generated source archives without becoming latest

#### Scenario: Custom stylesheet is added later
- **WHEN** a verified build uses custom CSS
- **THEN** its installation artifact and release include the same `styles.css` file

#### Scenario: Development artifact
- **WHEN** a development tagged build passes validation, build, and tests
- **THEN** its CI artifact provides the required installation files and no GitHub Release can be published for that development tag

#### Scenario: Failed verification
- **WHEN** validation, build, required tests, or publication verification fails
- **THEN** no successful installation artifact or GitHub Release is published for that request; diagnostic coverage artifacts can still be uploaded

#### Scenario: Branch creation
- **WHEN** a matching stabilization branch is created
- **THEN** branch CI can run, but no compilation is performed as a publication step and no Release is automatically created

## ADDED Requirements

### Requirement: Verified artifact promotion
Publication SHALL select an explicit destination tag, source build run and attempt, and artifact identity from the same repository. The source SHALL be a successful approved tag-build workflow for the selected candidate tag and commit, with complete required checks. Publication SHALL verify authoritative workflow/run/artifact information, tag resolution, recorded versions, installation file names, and content hashes before writing a release. Artifacts from PR builds, another repository, an unsuccessful run, or a different commit SHALL NOT be promoted. Missing, deleted, expired, or corrupted artifacts SHALL fail promotion without a fallback compilation or substitution of another run.

#### Scenario: Valid provenance
- **WHEN** selected candidate artifact matches the successful approved tag-build run, attempt, source tag, commit, and file hashes
- **THEN** publication proceeds with those verified files

#### Scenario: Invalid provenance
- **WHEN** supplied metadata or authoritative run/artifact information disagrees, or files are missing or corrupted
- **THEN** publication fails before creating a release

#### Scenario: Expired artifact
- **WHEN** the selected artifact is expired or deleted
- **THEN** publication explains that candidate evidence is unavailable and neither rebuilds nor selects another artifact automatically

#### Scenario: Concurrent request
- **WHEN** two requests target the same destination tag
- **THEN** release mutations are serialized and neither request replaces the other's assets

### Requirement: Complete and repeatable release publication
Publication SHALL create a draft, attach the complete installation asset set, verify uploaded names and hashes, and only then publish with the required channel and latest status. Retries SHALL verify matching existing assets and resume incomplete matching drafts without replacing existing assets. A published release with matching source, files, and channel SHALL be accepted as already complete; a conflict SHALL fail without deleting, overwriting, or retagging published content. These rules SHALL also work when GitHub immutable releases are enabled.

#### Scenario: Interrupted upload
- **WHEN** publication stops after a draft and some verified assets have been created
- **THEN** a retry verifies those assets, attaches only missing expected assets, and publishes only after the full set passes verification

#### Scenario: Repeat completed publication
- **WHEN** publication is repeated for an already published matching release
- **THEN** it reports completion without changing installation assets

#### Scenario: Conflicting existing content
- **WHEN** an existing draft or published release contains different or unexpected assets, source identity, or publication status
- **THEN** the request fails and preserves existing content

### Requirement: Repository development and release guidance
The repository SHALL provide root `CONTRIBUTION.md` with development prerequisites, build and verification commands, branch/PR rules, tag examples, stabilization and promotion steps, failure handling, and a release-cycle diagram. It SHALL provide concise root `AGENTS.md` with plugin and CLI concepts, repository layout, essential data and credential invariants, discovery/development/verification instructions, branch/release rules, and links to detailed guides. Both documents and README SHALL describe the implemented CI behavior consistently and distinguish plugin distribution from source installation of `fos`.

#### Scenario: Contributor follows release instructions
- **WHEN** a contributor follows the documented candidate-to-stable cycle
- **THEN** the instructions identify the exact source tag and artifact to promote, preserve tested files, and include returning release fixes to `dev`

#### Scenario: Agent starts a repository task
- **WHEN** an agent reads root `AGENTS.md`
- **THEN** it can identify plugin, protocol, CLI, tests, relevant development commands, architectural invariants, and detailed reference documents without machine-specific paths
