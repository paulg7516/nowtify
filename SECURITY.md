# Nowtify - Security Model

This document describes the security posture of Nowtify, the threat model the
codebase is built against, and the operational controls required around the
release pipeline. Maintained for security review.

Last reviewed: 2026-05-25.

## What Nowtify holds

Nowtify is a single-user macOS menu-bar app that polls Atlassian JSM on behalf
of the logged-in user. The only secret it stores is an **Atlassian API
token**. Everything else (site URL, email, watch list, triggers) is non-secret
configuration.

The token, presented to JSM as HTTP Basic auth (`email:token`), grants the
authenticating user's full Atlassian REST API access (read tickets, search
users, list projects, etc.). It does not grant admin operations unless the
user themselves is an admin.

## In-process protections

| Mitigation | Where |
|---|---|
| `contextIsolation: true` on every BrowserWindow | `src/main/index.js`, `src/main/overlay-windows.js`, `src/main/tray-manager.js` |
| `nodeIntegration: false` on every BrowserWindow | same |
| Preload scripts expose only typed IPC channels via `contextBridge` | `src/preload/*.js` |
| Content-Security-Policy on every renderer HTML (`default-src 'self'`, `connect-src 'none'`) | `src/renderer/*/*.html` |
| API token encrypted at rest via Electron `safeStorage` (macOS Keychain) | `src/main/store.js` |
| Token never sent to renderer (`getAllForRenderer` redacts) | `src/main/store.js`, `src/main/index.js` |
| Config file permissions locked to owner (`chmod 0600`) | `src/main/store.js` `lockdownConfigFile` |
| JSM site URL must be `https://` (Basic auth refuses cleartext) | `src/main/jsm-client.js` `isHttpsSite` |
| `shell.openExternal` allowlist (configured JSM host, `id.atlassian.com`, `teams.microsoft.com`) | `src/main/index.js` `safeOpenExternal` |
| `settings:save` whitelists top-level keys | `src/main/index.js` `ALLOWED_SAVE_KEYS` |
| All user-controlled strings rendered via `textContent` (no `innerHTML` interpolation) | renderer code |

## At-rest token storage

The token is encrypted via `safeStorage.encryptString()`, which on macOS
delegates to the system Keychain. The encrypted blob is base64-stored under
`jsm.apiTokenEnc` in `~/Library/Application Support/Nowtify/sla-overlay-config.json`,
and the file itself is chmod 0600.

On first launch after upgrading from a pre-encryption build, any plaintext
token under `jsm.apiToken` is transparently re-encrypted and the plaintext
field is deleted. Migration is one-shot and best-effort - if Keychain access
is denied, the token storage call throws rather than silently downgrading to
plaintext.

## Release pipeline and the unsigned-binary gap

**Known gap**: Nowtify is currently distributed unsigned and unnotarized
(`package.json` `mac.identity: null`, `hardenedRuntime: false`). This means:

1. macOS Gatekeeper shows the "unidentified developer" warning on first
   install. Users have to right-click → Open to bypass.
2. **Auto-update integrity rests entirely on GitHub Releases trust.**
   `electron-updater` verifies the SHA-512 of each downloaded ZIP against the
   `latest-mac.yml` manifest published alongside it, so a tampered ZIP in
   transit is rejected. But the manifest itself is unsigned: anyone who can
   publish to the GitHub repo's Releases (i.e. anyone holding a write token
   on `paulg7516/nowtify`) can ship a malicious binary that every installed
   copy will install on next launch.

### Compensating controls (required for production deployment)

Until Nowtify is signed with an Apple Developer ID, the integrity of the
update channel depends entirely on GitHub-side controls. These are the
non-negotiable operational requirements:

- [ ] **2FA enforced** on the `paulg7516` GitHub account (TOTP or hardware key)
- [ ] **Branch protection** on `main`: require PR review, disallow force-push
- [ ] **Release tokens scoped narrowly**: classic PAT with `public_repo` only,
      no `repo` or `admin:org`. Rotate quarterly.
- [ ] **`GH_TOKEN` stored in shell config only**, never echoed, never pasted
      into chat, never committed. Treat as production secret.
- [ ] **Releases gated through `npm run ship`** (which runs locally and
      requires the local machine's credentials) - no CI write access to
      `gh-actions` / `GITHUB_TOKEN` with release-publish scope.

### Fix path

Buying an Apple Developer ID ($99/yr) closes this gap entirely:

1. Set `mac.identity` to the Developer ID Application certificate name
2. Set `mac.hardenedRuntime: true` and `mac.gatekeeperAssess: true`
3. Add notarization step (`electron-builder` does this automatically when
   `APPLE_ID` / `APPLE_ID_PASS` / `APPLE_TEAM_ID` env vars are set)

Squirrel.Mac then verifies the embedded code signature on every update before
swapping the binary. A compromise of the GitHub repo would still let an
attacker push malicious bytes, but those bytes would fail signature
verification at install time and the update would be rejected.

## Out-of-scope threats

- **Malware running as the same user**: any process running as the user can
  read the encrypted blob and ask the OS Keychain to decrypt it (`safeStorage`
  uses an app-scoped key but does not require user reauthentication). This is
  inherent to per-user Keychain storage and is the same posture as any other
  Electron app that uses `safeStorage`. Mitigated by EDR, not by Nowtify.
- **Compromise of the Atlassian account itself**: if the user's Atlassian
  credentials are phished, attacker gets the same API access whether or not
  Nowtify exists.
- **JSM admin embedding malicious URLs in tickets**: the `openExternal`
  allowlist limits the blast radius to your configured JSM host,
  `id.atlassian.com`, and `teams.microsoft.com`. A malicious JSM admin can't
  point Nowtify-clicks at arbitrary attacker URLs.

## Reporting

Found something? Email the maintainer (see `package.json` author field) or
open a private security advisory on the GitHub repo.
