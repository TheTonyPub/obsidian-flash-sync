## ADDED Requirements

### Requirement: Scope is a per-device gitignore-style rule list
The plugin SHALL keep a pattern list and a mode, Exclude (default) or Only selected, in ordinary settings on each device. Patterns SHALL support comments, blank lines, `*`, `**`, `?`, leading `/`, trailing `/`, and `!` negation. The last matching line SHALL decide, a matched directory SHALL cover everything beneath it, and matching SHALL be case-insensitive. In Exclude mode a path with no match SHALL sync. In Only selected mode it SHALL NOT.

#### Scenario: Exclude a folder
- **WHEN** the list contains `code/` in Exclude mode
- **THEN** `code/app/main.py` is out of scope and `notes/a.md` is in scope

#### Scenario: Only selected formats
- **WHEN** the mode is Only selected and the list contains `*.md` and `Attachments/`
- **THEN** `a/b.md` and `Attachments/x.png` sync and `a/b.py` does not

#### Scenario: Negation carves out
- **WHEN** the mode is Only selected with `Projects/` and `!Projects/private/`
- **THEN** `Projects/private/a.md` is out of scope

### Requirement: Common junk is skipped by default
With the built-in skip list enabled (default), a path with a part named `venv`, `.venv`, `node_modules`, `__pycache__`, `.git`, `.idea`, `.vscode`, `.DS_Store`, `Thumbs.db`, or ending `.pyc`, SHALL be out of scope in both modes regardless of user lines. Disabling the toggle SHALL remove only this list. The conflict-review folder and dot-prefixed path parts SHALL stay out of scope in every configuration.

#### Scenario: Visible virtualenv
- **WHEN** a visible `scripts/venv/lib/x.py` is created
- **THEN** it is not captured, queued or uploaded

### Requirement: Out-of-scope paths are never deleted by scope
The plugin SHALL ignore out-of-scope local create, modify, rename and delete events and startup scan entries, and SHALL NOT write out-of-scope remote records locally. It SHALL NOT publish a tombstone, rename or path release, nor delete a local or remote file, because of a scope change. A rename across the boundary SHALL be handled as delete (in to out) or create (out to in). When a path re-enters scope, reconciliation SHALL apply it through the normal idempotent flow.

#### Scenario: Already synced file becomes excluded
- **WHEN** `code/a.py` is synced and the user adds `code/`
- **THEN** the local file and the remote record stay as they are, later edits are not synced, and no tombstone is written

#### Scenario: Remote file out of scope
- **WHEN** a peer uploads `venv/x.py` and this device excludes it
- **THEN** no local file is created and the remote record is unchanged

#### Scenario: Rename into scope
- **WHEN** an out-of-scope file is renamed into an in-scope path
- **THEN** it is captured as a new file with a new `fileId`

### Requirement: Pending work survives a scope change
Queued outbox operations for a path that leaves scope SHALL be held with their content intact and SHALL NOT upload. When the path returns to scope they SHALL resume. Sync SHALL show the held count and SHALL NOT report convergence while held operations exist for in-scope paths.

#### Scenario: Rule added with queued edit
- **WHEN** an edit to `code/a.py` is queued offline and the user then adds `code/`
- **THEN** the edit is held, not dropped or uploaded, and the held count is 1

#### Scenario: Rule removed
- **WHEN** the user removes `code/` while one operation is held for it
- **THEN** the held operation resumes and syncs
