# Nowtify Security Audit - 2026-06-02

This document captures the findings of an internal pre-release security review of Nowtify v0.5.24, with the actionable findings remediated in v0.5.25. Written so a security reviewer can skim the catalog in five minutes and trust that careful work was done.

The review covered: credential storage at rest, IPC handler surface, Electron BrowserWindow security flags, Content Security Policy on all renderers, external URL allowlisting, OAuth (PKCE / state / redirect URI / token rotation), auto-update integrity, JSM and MS Graph clients, click-through overlay window risks, the SVG rasterizer hidden window, diagnostic logging, build configuration, runtime dependencies, preload bridges, settings-file permissions, and auto-launch / persistence behaviour.

## Summary

**Total findings: 14**

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | n/a |
| High | 1 | Fixed in v0.5.25 |
| Medium | 5 | 3 fixed in v0.5.25 / 2 accepted (documented) |
| Low | 4 | 1 fixed in v0.5.25 / 3 accepted (documented) |
| Informational | 4 | Accepted / documented |

## Findings (remediated in v0.5.25)

### H-01. Renderer-callable IPC handlers could trigger unsigned bundle replacement

**Severity:** High - **Fixed in v0.5.25**

- `src/main/index.js:412` `popover:install-update-now`
- `src/main/index.js:478` `settings:install-update-now`

Both handlers invoke `performUnsignedUpdate`, which writes a bash helper to `os.tmpdir()`, spawns it detached, then the helper replaces the running `.app` bundle. The `zipPath` argument itself was not attacker-controlled (sourced from `updaterStatus.downloadedFile` which the main process sets only on `electron-updater`'s `update-downloaded` event), so the worst-case impact was a compromised renderer forcing early install of an already-downloaded-and-verified update. Surface was too wide regardless.

**Fix:** New `isTrustedSender(event)` helper in `src/main/index.js` verifies the IPC sender's `mainFrame` is either `settingsWin.webContents.mainFrame` or `tray.popover.webContents.mainFrame` before processing. Untrusted calls are logged and rejected. Applied to all five destructive handlers (`settings:save`, `settings:disconnect`, `settings:teams-disconnect`, `popover:install-update-now`, `settings:install-update-now`).

### M-02. Renderer windows did not opt in to `sandbox: true`

**Severity:** Medium - **Fixed in v0.5.25**

- `src/main/index.js` (settings window)
- `src/main/overlay-windows.js` (overlay windows)
- `src/main/tray-manager.js` (popover window)

Only the offscreen rasterizer in `tray-manager.js:64` set `sandbox: true`. The three user-facing windows relied on `contextIsolation: true` + `nodeIntegration: false`, which is almost the same thing but still allows the renderer's V8 isolate full process privileges if a sandbox-escape exploit lands.

**Fix:** Added `sandbox: true` to all three `webPreferences` blocks. The preload scripts use only `contextBridge` + `ipcRenderer`, both of which are sandbox-compatible, so this is a no-impact change for the existing UI.

### M-03. No global `app.on('web-contents-created')` navigation guard

**Severity:** Medium - **Fixed in v0.5.25**

`src/main/index.js`

No global handler for `web-contents-created` was installed, meaning a renderer could in theory `window.open()` an arbitrary URL into a new BrowserWindow with default `webPreferences`, or navigate the current window to a non-`file://` origin. The strict CSP (`connect-src 'none'`, `frame-ancestors 'none'`) makes that hard to exploit, but it's a defence-in-depth gap.

**Fix:** Added `app.on('web-contents-created', ...)` at module load. The handler:
- `contents.setWindowOpenHandler(() => ({ action: 'deny' }))` - deny every `window.open` request
- `contents.on('will-navigate', e => !url.startsWith('file://') && e.preventDefault())` - block any navigation away from the bundled HTML

### M-04. No sender-frame verification on sensitive IPC handlers

**Severity:** Medium - **Fixed in v0.5.25**

`src/main/index.js` - all sensitive `ipcMain.handle()` registrations

Same fix as H-01 above. The `isTrustedSender(event)` helper is applied to all five handlers whose effects are destructive or sensitive (token clear, settings overwrite, install-update). Untrusted calls return a safe default and log a `[security]` warning.

### L-01. `lockdownConfigFile()` ran after `electron-store` had already written the file at 0644

**Severity:** Low - **Fixed in v0.5.25**

`src/main/store.js`

`new Store({ defaults })` writes the defaults to disk synchronously the moment the constructor runs if the file does not already exist. That write used `electron-store`'s default mode (typically `0644`). The previous `chmod 0600` did not run until `app.whenReady()` resolved, leaving a small first-launch window where the (empty) defaults file was world-readable.

**Fix:** Moved the `lockdownConfigFile()` call from `app.whenReady().then(...)` to a synchronous call immediately after `new Store(...)`. `fs.chmodSync` does not require Electron to be ready.

## Findings (accepted risks)

### M-01. Unsigned, unnotarized macOS bundle

**Severity:** Medium - **Accepted (documented in `SECURITY.md`)**

`package.json:53-55` - `identity: null`, `hardenedRuntime: false`, `gatekeeperAssess: false`.

Anyone with `public_repo` write on `paulg7516/nowtify` can publish a malicious DMG/ZIP and `latest-mac.yml`; every installed copy auto-installs it on next launch. `electron-updater` verifies SHA-512 against the manifest, but the manifest itself is not signed.

**Compensating controls** (already in `SECURITY.md`): GitHub 2FA on the release-controlling account, branch protection on `main`, no CI release access, narrow PAT scopes, single-person release pipeline.

**Fix path:** purchase Apple Developer ID ($99/year), set `mac.identity` + `hardenedRuntime: true` + notarization.

### M-05. Encrypted tokens + refresh tokens are recoverable by same-user processes

**Severity:** Medium - **Accepted (documented in `SECURITY.md`)**

`src/main/store.js`

`safeStorage` on macOS uses an app-scoped Keychain entry that does not require user reauthentication on each decrypt. Any code running as the user can re-launch Nowtify or load `electron-store` in their own Electron host and recover the JSM API token plus the long-lived M365 refresh token. Same posture as Slack/VSCode/every other Electron app on the platform.

**Compensating controls:** end-user EDR; full-disk encryption.

### L-02. JSM group-name interpolation into JQL uses quote-escape only

**Severity:** Low - **Accepted**

`src/main/jsm-client.js:310-321`

`name.replace(/"/g, '\\"')` is the right approach for JQL string literals, but a group name containing backslashes could in theory escape the escape. Real-world impact is near-zero: the group name comes from the same Atlassian instance that's receiving the query, and the worst outcome is a malformed JQL that returns 400.

### L-03. `JsmClient.request` accepts absolute URLs that bypass the configured site

**Severity:** Low - **Accepted (no live call site)**

`src/main/jsm-client.js:42`

Currently no call site passes an absolute URL, so this is dead code. Worth tightening only if a future call ever passes a server-supplied URL. Recommendation noted: either remove the `path.startsWith('http')` branch or add a hostname-equality check against `siteUrl`.

### L-04. `nowtify://` custom URL scheme can be claimed by a later-installed app

**Severity:** Low - **Accepted (inherent to unsigned macOS apps)**

`package.json:60-65` + `src/main/index.js:121`

Custom URL schemes on macOS are first-come-first-served at the Launch Services level. Mitigations already in place: the PKCE `code_verifier` is held only in memory in the originating process; the `state` parameter is checked. A hijacker capturing the callback URL still cannot exchange the code without the verifier. Worst case: denial of service against M365 sign-in. Fix path is the same Apple Developer ID + Universal Links route.

## Findings (informational)

### I-01. Diagnostic logs print Graph user IDs

`src/main/ms-graph-client.js:166-168`

Sender Graph IDs (AAD object IDs) appear in one debug log. These are tenant-identifiable but not credentials. **No** token, refresh token, API token, Basic-auth header, or Bearer header is logged anywhere in the codebase. The `[open-url]` log truncates to 120 characters; the OAuth code is much longer than that, so the full code does not land in the log.

### I-02. CSP correctly relies on main-process scoped network

All HTTP fetches happen in the main process (`jsm-client.js`, `ms-graph-client.js`, `ms-graph-oauth.js`) which CSP does not constrain. The renderer truly has zero ability to make outbound requests. `style-src 'unsafe-inline'` and `img-src data:` are the only relaxations - both required for the existing UI. One of the strongest Electron CSPs the audit's seen.

### I-03. Update helper writes to per-user `os.tmpdir()`, not shared `/tmp`

`src/main/index.js` - `performUnsignedUpdate`

The code uses `os.tmpdir()` (which on macOS is per-user `/var/folders/...`), not the shared `/tmp` referenced in some doc comments. Per-user-isolated, so no cross-user interference. Doc comments should be tightened for clarity.

### I-04. No `setPermissionRequestHandler` / `setPermissionCheckHandler`

Nowtify never asks for camera, microphone, geolocation, notifications-via-renderer etc. With CSP `connect-src 'none'` and no `<webview>` / `<iframe>`, this is moot. Listed for completeness only.

## Strengths

The codebase does a lot right, and the security team should weight this list when reading the findings.

1. **Encrypted secret storage via `safeStorage` → macOS Keychain** for both the JSM API token and the M365 access + refresh tokens. Refuses to write tokens if Keychain is unavailable instead of silently downgrading to plaintext. One-shot plaintext-to-encrypted migration on first read after upgrade.
2. **Tokens never reach the renderer.** `getAllForRenderer` returns only `hasApiToken` booleans. Token field shows a bullets sentinel in the UI; empty-or-bullets on save means "keep existing" so the renderer cannot even probe the token.
3. **Strict CSP on all three renderer HTMLs** with `connect-src 'none'` and `frame-ancestors 'none'`. Among the strongest Electron CSPs in the wild.
4. **`contextIsolation: true` + `nodeIntegration: false` + (as of v0.5.25) `sandbox: true`** on all four BrowserWindows. Preloads expose only narrow typed IPC channels via `contextBridge`.
5. **`shell.openExternal` allowlist** with HTTPS/HTTP-only check, host normalization, blocks `javascript:` and `file://` URLs, limited to the configured JSM hostname + `id.atlassian.com` + `*.teams.microsoft.com`.
6. **`settings:save` allowlist of permitted top-level keys** plus per-key type validators. A compromised renderer cannot write `snoozeUntil`, `jsm.apiTokenEnc`, or arbitrary keys.
7. **HTTPS-only enforcement for JSM Basic auth.** Refuses to send credentials over HTTP. Per-request URL re-check.
8. **PKCE with S256** for the Microsoft OAuth flow. State parameter generated and validated. 5-minute timeout on `pendingAuth`. Refresh-token rotation race handled via in-flight promise de-dup.
9. **Single-instance lock** so a malicious second copy can't observe pending OAuth state.
10. **SVG color sanitization** before splicing into the tray-icon SVG - tight regex `^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`, no escape, no script. The data-URL HTML the rasterizer loads also runs with `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`.
11. **Renderer DOM updates use `textContent` for all user-controlled strings.** All `innerHTML` usages interpolate either static SVG markup or static ASCII text - no `${userField}` in any `innerHTML`.
12. **Config file `chmod 0600`** so other-user processes cannot read the encrypted blob.
13. **Auto-update integrity checked at byte level** by electron-updater against `latest-mac.yml` SHA-512. Not perfect (the manifest itself is unsigned, see M-01), but it stops in-transit tampering.
14. **Thoughtful threat-model document** (`SECURITY.md`) that explicitly names what's in vs out of scope and what compensating controls are required for the unsigned-bundle gap.
15. **`window-all-closed` preventDefault** plus `setMenu(null)` on the settings window. No menu-bar exploit surface; devtools shortcut is not bound.

## File:line index

| Topic | File:line |
|---|---|
| Token at-rest crypto (JSM) | `src/main/store.js:237-300` |
| Token at-rest crypto (Teams) | `src/main/store.js:480-561` |
| `lockdownConfigFile` (now synchronous) | `src/main/store.js:106-117` |
| IPC handler registrations | `src/main/index.js:286-540` |
| `isTrustedSender` helper | `src/main/index.js` (top of `wireIpc`) |
| `ALLOWED_SAVE_KEYS` + `SAVE_VALIDATORS` | `src/main/index.js:37-44, 296-318` |
| `isAllowedExternalHost` + `safeOpenExternal` | `src/main/index.js:52-85` |
| `web-contents-created` guard (new) | `src/main/index.js` (after `window-all-closed`) |
| Settings BrowserWindow (+ sandbox) | `src/main/index.js` |
| Overlay BrowserWindows (+ sandbox) | `src/main/overlay-windows.js` |
| Popover BrowserWindow (+ sandbox) | `src/main/tray-manager.js` |
| Rasterizer BrowserWindow (sandbox already on) | `src/main/tray-manager.js:56-71` |
| CSP meta tags | `src/renderer/{settings,popover,overlay}/*.html:5` |
| Preload bridges | `src/preload/*.js` |
| `performUnsignedUpdate` helper | `src/main/index.js` |
| OAuth PKCE + state | `src/main/ms-graph-oauth.js` |
| OAuth token exchange/refresh | `src/main/ms-graph-oauth.js` |
| JSM client HTTPS enforcement | `src/main/jsm-client.js` |
| SVG color sanitization | `src/main/tray-manager.js:11-16` |
