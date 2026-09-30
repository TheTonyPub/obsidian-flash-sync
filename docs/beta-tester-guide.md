# flash-sync beta tester guide

This guide takes you from nothing to a vault that syncs between your devices:

1. Install the plugin in Obsidian through BRAT.
2. Set up your own remote server with the `fos` CLI.
3. Import the settings that `fos` generates into Obsidian.

flash-sync is self-hosted. Nobody hosts a server for you: you run NATS and Caddy on a server you control, and the plugin connects to it directly over WSS.

> [!WARNING]
> Beta builds can have bugs. Before you connect a vault, make a full backup of it, or start with a new test vault. Conflicting content is kept as a conflict copy, but a backup is still the only complete safety net.

## What you need

- Obsidian 1.11.4 or newer on Desktop, iOS or Android.
- A server: Debian 13, Ubuntu 24.04 or Ubuntu 26.04 on amd64, with root (`sudo`) access over SSH.
- A domain name whose DNS record points to that server. IP-only endpoints are not supported.
- Inbound TCP 80 and 443 open to the server, so Caddy can get and renew the TLS certificate. NATS itself is never exposed.
- Node.js 22, npm and Git on the server. For container mode you also need Docker Engine with Compose, or Podman 5 with `podman-compose`; native mode needs neither.

S3 is optional. Without it, Markdown and other files under the inline limit (512 KiB by default) sync; larger attachments stay local. See [S3 is optional](../README.md#s3-is-optional).

## 1. Install the plugin with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs and updates plugins that are not in the community catalogue.

1. In Obsidian open **Settings → Community plugins**, turn off restricted mode if asked, choose **Browse**, search for **BRAT** (*Obsidian42 - BRAT*), then **Install** and **Enable** it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter the repository `TheTonyPub/obsidian-flash-sync` (or `https://github.com/TheTonyPub/obsidian-flash-sync`).
4. If BRAT offers a version choice, pick the newest `x.y.z-beta.N` tag listed on the [releases page](https://github.com/TheTonyPub/obsidian-flash-sync/releases). Every release has `main.js`, `manifest.json` and `styles.css` attached, which is what BRAT needs.
5. Confirm. BRAT downloads the files into `.obsidian/plugins/flash-sync/`.
6. In **Settings → Community plugins**, enable **flash-sync**.

All flash-sync releases so far are prereleases. BRAT's default "latest release" lookup can skip prereleases; if it reports that no release was found, use the frozen-version command, **BRAT: Add a beta plugin with frozen version based on a release tag**, and enter the beta tag from the releases page. A frozen version does not auto-update: when a new beta is announced, run the same command again with the new tag, or remove the plugin from BRAT and add it again.

**If BRAT does not work**, install manually. Download `main.js`, `manifest.json` and `styles.css` from the same release, put them in `<vault>/.obsidian/plugins/flash-sync/`, restart Obsidian and enable the plugin. Details are in [Manual installation from a release](../README.md#manual-installation-from-a-release). Do not use GitHub's *Source code* archives: they are not install packages.

> [!NOTE]
> Install the plugin on every device where you want to sync. On iPhone and iPad the plugin folder is hidden in the Files app; see [flash-sync on iPhone](iphone-setup.md). On a phone, BRAT installs the plugin directly, so the hidden-folder steps are not needed.

## 2. Set up the server with fos

`fos` runs on the server it configures; it does not connect to a remote host itself. SSH into the server first and run every command below there.

### Prepare the server

Point your domain at the server, for example `sync.example.com`, and open TCP 80 and 443. Install Node.js 22, npm and Git with your usual method, then build and install `fos` from source:

```sh
git clone https://github.com/TheTonyPub/obsidian-flash-sync.git
cd obsidian-flash-sync
git checkout <beta-tag>   # the same tag you installed through BRAT, for example the newest x.y.z-beta.N
npm ci
npm run build:server-cli
sudo npm install --global ./packages/server-cli
command -v fos
```

`fos` is not an APT package and the plugin release does not include it. More detail, including updates, is in [Install fos from source](fos-install.md).

### Bootstrap

First preview what `fos` will do; this changes nothing:

```sh
sudo fos plan
```

Then run the guided installer. Replace the endpoint with your own domain:

```sh
sudo fos bootstrap --wss-endpoint wss://sync.example.com --keep
```

The installer asks for the mode (native, Docker Compose or Podman Compose), the domain, an optional ACME email, the first vault ID and the firewall and service-account choices. Native is the simplest choice on a plain Debian/Ubuntu host. It then shows a redacted plan; confirmation defaults to **Cancel**, so choose **Apply** to proceed. The vault ID is a short name you pick, such as `my_vault`; it is not a secret.

`--keep` makes `fos` retain this vault's credential locally, so you can produce the import link again later with `sudo fos import --vault-id my_vault`. Without `--keep` the password is shown only once.

When it finishes, `fos` shows a protected handoff:

- The **administrator** credential. Save it in a password manager. You need it for later vault and user management. **Never put it into Obsidian.**
- The **vault** credential and an **Obsidian import URI** (`obsidian://flash-sync-import?data=…`) with a QR code. These are for Obsidian.

At the optional phrase prompt, press Enter for an unencrypted handoff, or type a phrase of at least eight characters to encrypt it. Use a phrase whenever the link or QR will travel through a chat, email or screenshot, and send the phrase through a different channel.

> [!CAUTION]
> The import URI, the QR code and the phrase together give full access to your vault. Do not post them publicly, commit them, or paste them into issues. Do not send them to anyone, including the project maintainers.

Check the installation:

```sh
sudo fos status
```

For unattended installation, extra vaults, rotating or revoking credentials, backups and upgrades see [Use fos](fos-usage.md). If something fails at the server level, see [NATS setup](nats-setup.md).

## 3. Import the settings into Obsidian

The import needs the flash-sync plugin installed and enabled on the device (step 1).

**On a phone (recommended for the QR code):** scan the QR from the `fos` terminal with the Camera app and open the Obsidian link. In the dialog enter the phrase if you set one, select **Preview settings**, check the vault ID and server address, then select **Import and connect**.

**On Desktop:**

1. Copy the full `obsidian://flash-sync-import?data=…` line from the terminal and open it in a browser or the operating system's "Open URL" function. Obsidian opens the import dialog.
2. Alternatively, open **Settings → Community plugins → flash-sync**, go to **Sync**, select **Paste transfer code**, and paste only the code: the text after `data=` in the URI, starting with `1.` (encrypted) or `2.` (plain).
3. Enter the phrase if you set one, select **Preview settings**, then **Import and connect**.

The preview shows the vault, the server and whether attachment storage is configured; passwords stay hidden. The plugin stores the NATS password in Obsidian's SecretStorage, and ordinary settings keep only an opaque reference.

If you prefer to type the values, use **Set up manually** on **Sync** and fill in **Vault ID**, **Server address**, **Username** and **Password** on **Server**, then **Save and reconnect**.

A device is bound to one vault ID. A link for a different vault is refused, and once connected the binding cannot be changed from settings.

## 4. Check that it works

- **Sync** shows **Synchronized** after the first reconciliation. **Syncing** briefly during activity is normal.
- Create or edit a note on one device and confirm it appears on the other.
- **Disconnected** usually means a wrong `wss://` address, DNS or TLS problem, or a stopped server. A sign-in error means the vault ID or credentials are wrong: import again, or use **Update password**.

## 5. Add another device

The easy way is from a device that already syncs the vault: on **Sync**, under **Other devices**, select **Create QR code** next to **Send settings to a new device**. The plugin generates a code phrase; keep it separate from the QR. On the new device scan the QR or open the link, enter the phrase, preview and import. This is unavailable while the sending device cannot sign in.

Or produce a fresh handoff on the server from the retained credential:

```sh
sudo fos import --vault-id my_vault
```

On a new device start from an **empty** vault, and do not copy `.obsidian` or the plugin's `data.json` from another device: they hold a device ID and device-specific secret references. Notes arrive through sync. When joining a vault that already contains notes, back up the local vault first. See also [flash-sync on iPhone](iphone-setup.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| BRAT says no release found | Use **BRAT: Add a beta plugin with frozen version based on a release tag** with the tag from the releases page, or install manually. |
| Import link does nothing | The plugin must be installed and enabled first. Try **Paste transfer code** in **Sync** instead. |
| "Code phrase must contain at least 8 characters" | The link is encrypted. Enter the phrase chosen when it was created. |
| Import blocked: different vault | The device is already bound to another vault ID. Use a new empty vault for this server. |
| **Disconnected** | Check the `wss://` address, that DNS points to the server, that ports 80 and 443 are open, and `sudo fos status` on the server. |
| Cannot sign in | Wrong or rotated credential. Re-import, or on the server `sudo fos import --vault-id my_vault` (needs `--keep` at creation; otherwise rotate with `sudo fos vault rotate --vault-id my_vault --keep`). |
| Large images or files do not sync | Expected without S3. Enable **Attachment storage** on **Server** and fill in all S3 fields; the bucket needs a CORS rule for `app://obsidian.md` (see [NATS setup](nats-setup.md#plugin-configuration-and-optional-s3)). |
| `fos import` says the password cannot be recovered | The credential was not kept. Rotate the vault credential with `--keep` and import the new handoff on every device. |

## Reporting a problem

Open an issue on [GitHub](https://github.com/TheTonyPub/obsidian-flash-sync/issues) with the plugin version (from **BRAT** or `manifest.json`), the platform, what you did and what happened. Under **Settings → flash-sync → Advanced → Diagnostics**, **Copy report** produces a redacted status report; you can also turn on **Debug logging** and copy the `[flash-sync]` lines from the developer console, as described in [diagnostics](diagnostics.md). Check the text before posting. Never include import links, QR codes, phrases, passwords or the administrator credential.
