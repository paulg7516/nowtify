# Nowtify Security Audit Refresh - 2026-06-08

This refreshes the [2026-06-02 audit](./security-audit-2026-06-02.md) against
the current `main`, which now includes the **Windows port** and a move of the
release build to **GitHub Actions CI**. It records the delta review and the
remediations applied on 2026-06-08. References are anchored by file +
**function name** (stable across edits) rather than line numbers.

## Posture summary

- **Critical findings: 0.** No high or medium findings are left open and
  un-mitigated.
- The 2026-06-02 audit's fixes (sender-frame checks, sandbox on all windows,
  navigation guard, synchronous config lockdown) are all still present and were
  re-verified after the Windows refactors - e.g. `isTrustedSender` still guards
  the install-update IPC handlers even though the updater moved into
  `src/main/updater.js`.
- The delta review found **one material item** (release pipeline moved to CI)
  and several accuracy gaps; **all are remediated below.**
- Remaining residual risk is the **unsigned binary** on both platforms, with
  the documented compensating controls now strengthened (release approval gate,
  pinned actions, protected branch/tags). Closing it fully requires code-signing
  certificates (cost), not code changes.

## Delta findings + remediation (this refresh)

### D-01. Release publishing moved into CI, widening the unsigned-update supply chain
**Severity: Medium - FIXED (2026-06-08).**

The Windows work moved releases from a local `npm run ship` to GitHub Actions
(`.github/workflows/release.yml` publishes on a `v*` tag with `GITHUB_TOKEN`).
For an unsigned, auto-updating app, anyone able to publish a release can ship
code to every client, so this contradicted the prior "no CI release access"
control.

**Remediation applied:**
- Publish job now runs in a protected **`release` environment with a required
  reviewer** - a human approves every release before bytes ship.
- All actions **pinned to commit SHAs**.
- **Rulesets** protect `main` and `v*` tags from deletion + force-push.
- Workflow uses the run-scoped, least-privilege `GITHUB_TOKEN` (`contents: write`).
- `SECURITY.md` rewritten to describe this model accurately.

### D-02. `JsmClient.request` accepted absolute URLs to any host (was L-03, accepted)
**Severity: Low - FIXED (2026-06-08).** `src/main/jsm-client.js` `request`.
An absolute request URL must now match the configured JSM host, so the
Basic-auth credentials can never be sent elsewhere. Relative paths (the only
live call sites) are unaffected.

### D-03. JQL group-name escaping (was L-02, accepted)
**Severity: Low - FIXED (2026-06-08).** `src/main/jsm-client.js`
`searchAssignedOpen`. Backslashes are now escaped before double-quotes, so a
group name cannot break out of the JQL string literal.

### D-04. Updater temp-path race (informational)
**FIXED (2026-06-08).** `src/main/updater.js` `performUnsignedUpdateMac` now
derives the staging dir and helper-script path from a single timestamp (was two
`Date.now()` calls that could desync and orphan the helper). macOS-only path.

### D-05. Windows platform deltas (accuracy - documented)
**Documented (2026-06-08).** Re-verified the Windows additions carry no new
high/medium risk; all are now reflected in `SECURITY.md`:
- `safeStorage` uses **Windows DPAPI** (not Keychain); same refuse-if-unavailable behavior. `src/main/store.js`.
- Config lockdown is a **no-op on Windows** (per-user `%APPDATA%` ACLs instead of `chmod 0600`). `src/main/platform.js` `lockdownFile`, `shouldLockdownFile`.
- `nowtify://` is registered on Windows; the OAuth callback arrives via `process.argv` (cold start) / `second-instance` (warm) and is routed through the same `state` + PKCE-validated handler. Same accepted scheme-claim risk as macOS. `src/main/index.js` `handleWindowsColdStartUrl`, `src/main/platform.js` `protocolClientArgs`.
- The Windows NSIS build is **unsigned** (SmartScreen) - same residual class as the macOS Gatekeeper gap; fix path is a Windows code-signing certificate.

### D-06. `openExternal` allowlist scope (accuracy)
**Documented (2026-06-08).** The allowlist now also permits **Outlook web**
hosts and converts validated `teams.microsoft.com` links to the `msteams:`
desktop-app scheme. The conversion only runs **after** the HTTPS Teams host is
validated, so it cannot be used to launch an arbitrary scheme. Logic is in
`src/main/links.js` `isAllowedExternalHost` + `src/main/index.js`
`safeOpenExternal`. `SECURITY.md` updated.

### D-07. Marketing-site analytics (informational)
The GitHub Pages site (`docs/index.html`) can load a third-party analytics
script (GoatCounter) - it is **disabled by default** (no code set) and loads
nothing until configured. The marketing page now also carries a restrictive
CSP. Not part of the app's trust boundary; noted for completeness.

## Prior findings - current status

All 14 findings from 2026-06-02 remain as recorded there; the High + the three
remediated Mediums + one Low are still fixed in code (re-verified). The
previously-accepted L-02 and L-03 are now **upgraded to FIXED** (D-02/D-03
above). The accepted M-01 (unsigned bundle) and M-05 (same-user keystore
recovery) remain accepted, with M-01's compensating controls strengthened by
D-01.

## Accepted residual risks (unchanged in principle)

- **Unsigned binaries (macOS + Windows).** Compensating controls in `SECURITY.md`; full fix = code-signing certificates.
- **Same-user process can recover secrets** via the OS keystore. Inherent to per-user Keychain/DPAPI; mitigated by EDR + full-disk encryption.
- **`nowtify://` scheme claim.** Mitigated by PKCE + state; worst case is M365 sign-in DoS.

## Current control index (function-anchored)

| Topic | Location |
|---|---|
| Secret at-rest crypto (JSM + Teams) | `src/main/store.js` `readDecryptedToken` / `writeEncryptedToken` / `readEncryptedTeamsField` |
| Config lockdown (cross-platform) | `src/main/platform.js` `lockdownFile` / `shouldLockdownFile` |
| Sender-frame check on sensitive IPC | `src/main/index.js` `isTrustedSender` |
| Save-key allowlist + validators | `src/main/index.js` `ALLOWED_SAVE_KEYS` / `SAVE_VALIDATORS` |
| External-URL allowlist + Teams app scheme | `src/main/links.js` `isAllowedExternalHost`, `src/main/index.js` `safeOpenExternal` |
| Navigation / window-open guard | `src/main/index.js` `web-contents-created` handler |
| JSM HTTPS + host-match enforcement | `src/main/jsm-client.js` `isHttpsSite` / `request` |
| JQL literal escaping | `src/main/jsm-client.js` `searchAssignedOpen` |
| OAuth PKCE + state | `src/main/ms-graph-oauth.js` |
| Windows deep-link routing | `src/main/index.js` `handleWindowsColdStartUrl`, `src/main/platform.js` `protocolClientArgs` |
| Auto-update install (mac helper / win NSIS) | `src/main/updater.js` `installDownloadedUpdate` / `performUnsignedUpdateMac` |
| Release pipeline + gates | `.github/workflows/release.yml`, repo rulesets, `release` environment |
| CSP (renderers) | `src/renderer/{settings,popover,overlay}/*.html` |
