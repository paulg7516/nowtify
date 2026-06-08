# Nowtify - Security Model

This document describes the security posture of Nowtify, the threat model the
codebase is built against, and the operational controls around the release
pipeline. Maintained for security review; every claim below is verifiable
against the source.

Last reviewed: 2026-06-08 (covers macOS + Windows).

## What Nowtify holds

Nowtify is a single-user menu-bar / system-tray app (macOS and Windows) that
polls Atlassian JSM and, optionally, Microsoft Graph on behalf of the
logged-in user. The secrets it stores are an **Atlassian API token** and,
if Microsoft 365 is connected, **MS Graph access + refresh tokens**.
Everything else (site URL, email, watch list, triggers) is non-secret config.

The JSM token, presented as HTTP Basic auth (`email:token`), grants the
authenticating user's Atlassian REST API access. It does not grant admin
operations unless the user themselves is an admin.

## In-process protections

| Mitigation | Where |
|---|---|
| `contextIsolation: true` on every BrowserWindow | `src/main/index.js`, `src/main/overlay-windows.js`, `src/main/tray-manager.js` |
| `nodeIntegration: false` on every BrowserWindow | same |
| `sandbox: true` on every BrowserWindow (settings, popover, overlay, rasterizer) | same |
| Preload scripts expose only typed IPC channels via `contextBridge` | `src/preload/*.js` |
| Content-Security-Policy on every renderer HTML (`default-src 'self'`, `connect-src 'none'`, `frame-ancestors 'none'`) | `src/renderer/*/*.html` |
| Global `web-contents-created` guard: deny `window.open`, block non-`file://` navigation | `src/main/index.js` |
| Secrets encrypted at rest via Electron `safeStorage` (macOS Keychain / Windows DPAPI) | `src/main/store.js` |
| Secrets never sent to renderer (`getAllForRenderer` redacts to `hasApiToken` booleans) | `src/main/store.js`, `src/main/index.js` |
| Config file locked to owner: `chmod 0600` on macOS, per-user `%APPDATA%` ACLs on Windows (chmod is a no-op there) | `src/main/platform.js` `lockdownFile`, `src/main/store.js` |
| Sensitive IPC handlers verify the sender frame (`isTrustedSender`) before acting | `src/main/index.js` |
| `settings:save` whitelists top-level keys + per-key type validators | `src/main/index.js` `ALLOWED_SAVE_KEYS` / `SAVE_VALIDATORS` |
| JSM site URL must be `https://`; an absolute request URL must match the configured host | `src/main/jsm-client.js` `isHttpsSite` / `request` |
| `shell.openExternal` allowlist (configured JSM host, `id.atlassian.com`, Microsoft Teams, Outlook web) | `src/main/links.js` `isAllowedExternalHost`, `src/main/index.js` `safeOpenExternal` |
| Teams links open the desktop app via `msteams:` only after the `teams.microsoft.com` host is validated | `src/main/index.js` `safeOpenExternal` |
| All user-controlled strings rendered via `textContent` (no `innerHTML` interpolation) | renderer code |

## At-rest secret storage

Secrets are encrypted via `safeStorage.encryptString()` - on macOS this
delegates to the system **Keychain**, on Windows to **DPAPI** (the per-user
Data Protection API). The encrypted blob is base64-stored under
`jsm.apiTokenEnc` (and `teams.*Enc` for Graph tokens) in the per-user app-data
directory (`~/Library/Application Support/Nowtify/` on macOS,
`%APPDATA%\Nowtify\` on Windows).

If the OS keystore is unavailable, the storage call **throws rather than
silently downgrading to plaintext**. On first launch after upgrading from a
pre-encryption build, any plaintext token is transparently re-encrypted and
the plaintext field deleted (one-shot, best-effort).

## Microsoft OAuth

The Microsoft 365 sign-in uses **PKCE with S256**, a generated + validated
`state` parameter, a 5-minute timeout on pending auth, and in-flight promise
de-duplication for refresh-token rotation. The callback returns via the
`nowtify://oauth/callback` custom scheme: on macOS through the `open-url`
event, on Windows through `process.argv` (cold start) or the single-instance
`second-instance` event (warm). The `code_verifier` lives only in memory in
the originating process, so a hijacker who captures the callback URL still
cannot exchange the code (see "custom URL scheme" under accepted risks).

## Release pipeline and the unsigned-binary gap

**Known residual gap:** Nowtify is currently distributed **unsigned** on both
platforms (`package.json` `mac.identity: null`; Windows NSIS unsigned). This
means macOS Gatekeeper and Windows SmartScreen warn on first install, and the
integrity of the auto-update channel rests on GitHub-side controls rather than
an embedded code signature.

`electron-updater` verifies the SHA-512 of each downloaded artifact against the
release manifest (`latest-mac.yml` / `latest.yml`), so an artifact tampered in
transit is rejected. The manifest itself is unsigned, so the controls below
constrain who can publish a release in the first place.

### Compensating controls (in place)

Releases are built by GitHub Actions (`.github/workflows/release.yml`), matrix
across macOS + Windows runners, triggered by a `v*` tag. The following controls
gate that pipeline:

- **Human approval on every publish.** The publish job runs in a protected
  GitHub **`release` environment with a required reviewer**, so a maintainer
  must approve each release in the GitHub UI before any bytes ship to clients.
  (`workflow_dispatch` test builds do not enter that environment and never
  publish.)
- **Pinned actions.** All third-party actions are pinned to full commit SHAs,
  not moveable tags, so a retargeted or compromised action tag cannot inject
  into the pipeline.
- **Branch + tag rulesets.** `main` and `v*` release tags are protected against
  deletion and non-fast-forward (force-push) via repository rulesets, so
  history and published release tags cannot be rewritten.
- **Least-privilege, ephemeral token.** The workflow uses the run-scoped
  `GITHUB_TOKEN` with `contents: write` only - no long-lived PAT, no org scope.
- **Account 2FA.** 2FA must be enforced on the release-controlling GitHub
  account (operational; verify in account settings).

### Fix path (closes the gap entirely)

Code-sign both platforms:
- **macOS:** Apple Developer ID ($99/yr) - set `mac.identity`,
  `hardenedRuntime: true`, and notarization env vars. Squirrel.Mac then
  verifies the signature on every update.
- **Windows:** an OV/EV code-signing certificate - signs the NSIS installer
  and removes the SmartScreen warning.

With signing in place, a repo compromise could still push bytes, but those
bytes would fail signature verification at install time and be rejected.

## Out-of-scope threats

- **Malware running as the same user**: any process running as the user can
  ask the OS keystore (Keychain / DPAPI) to decrypt the stored blob; neither
  requires per-decrypt reauthentication. This is inherent to per-user keystore
  storage and is the same posture as every other Electron app that uses
  `safeStorage`. Mitigated by EDR + full-disk encryption, not by Nowtify.
- **Compromise of the Atlassian / Microsoft account itself**: phished
  credentials give an attacker the same access whether or not Nowtify exists.
- **JSM admin embedding malicious URLs in tickets**: the `openExternal`
  allowlist limits the blast radius to the configured JSM host,
  `id.atlassian.com`, Microsoft Teams, and Outlook web. Arbitrary
  attacker-controlled destinations are blocked.
- **Custom URL scheme (`nowtify://`) claim**: custom schemes are
  first-come-first-served at the OS level, so a later app could claim it.
  Mitigated by PKCE (`code_verifier` in-memory only) + `state` validation;
  worst case is denial-of-service against M365 sign-in. Signing + Universal
  Links / per-app routes are the full fix.

## Reporting

Found something? Email the maintainer (see `package.json` author field) or
open a private security advisory on the GitHub repo.
