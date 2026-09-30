# Settings UI design reference

Approved visual direction for the flash-sync settings tab, used by the
`redesign-settings-ui` change. Requirements live in OpenSpec; this folder shows
layout, hierarchy, copy and states. Where they differ, the spec wins.

- `reference/*.png`: rendered screens, 2x scale. Desktop is 1200×900, mobile 390×844.
- `source/*.dc.html`: editable Design Component sources. `source/canvas.json` is the canvas index.
- Live canvas (owner access only): https://claude.ai/artifact/Lm9aGUmvzudSe1rgBwc9CZ

## Screens

| Reference | State |
|---|---|
| `Main` | Sync, synchronized; status-bar mode with preview |
| `Home-Conflicts` | Sync, 2 conflicts needing a decision and 1 waiting for sync |
| `Home-Error` | Sync, NATS sign-in failed; Send settings disabled |
| `Setup` | Sync, first run, not configured |
| `Server` | Server with one unsaved change and the save bar |
| `Add-Device` | Send settings modal with a protected QR code and link |
| `Advanced` | Inline limit, device ID, diagnostics |
| `Mobile-Home`, `Mobile-Conflict`, `Mobile-Server`, `Mobile-Share`, `Mobile-Advanced` | Mobile equivalents |
| `Dark-*` | Default Obsidian dark theme for Sync, Conflicts, Advanced and mobile Sync/Conflict |

## Structure

- Three sections: **Sync** (default), **Server**, **Advanced**. Desktop uses tabs; mobile uses a full-width segmented control.
- Sync, top to bottom: status summary (label, one sentence, server / attachments / upload queue), conflicts, other devices (send, receive), status-bar mode.
- Server: import hint, Sync server group, Attachment storage group with a switch, sticky unsaved-changes bar.
- Advanced: Sync (inline limit), This device (device ID), Diagnostics (debug logging, status report).

## Visual rules

- Colors map to Obsidian variables, never to the hex values in the mockups:
  `--background-primary`, `--background-secondary`, `--background-modifier-border`,
  `--text-normal`, `--text-muted`, `--text-faint`, `--interactive-accent`,
  `--text-on-accent`, `--color-green`, `--color-orange`, `--color-red`.
- Status always has an icon and a text label, never only a colored dot.
- Grouped rows sit in bordered cards with 10–12 px radius. Only one accent-filled primary action per view.
- Mobile: one column, controls at least 44 px tall, labels above inputs, bottom-anchored actions, conflict choices in a sheet.

## Known deviations

- The sample data is illustrative. Hosts, bucket, access key, device ID, counts and times are placeholders.
- The generated phrase in the mockups uses words; the implemented format is set in the change design.
- The QR codes are decorative patterns, not scannable payloads.
- The Obsidian window chrome and sidebar are simplified.

## Updating

Change the direction in the canvas or in `source/`, then refresh the PNGs and this
file together. Rendering is static: `sc-if`/`sc-for` need the canvas runtime, so
render from the canvas or expand those blocks before a headless browser screenshot.
Mark a PNG as pending here if it is not refreshed in the same change.
