# Code-signing setup (currently dormant)

Code signing is fully wired into the build (`package.json`) and the release
workflow (`.github/workflows/release.yml`), but it stays **dormant** until the
certificate secrets are added: while the `*_CSC_LINK` secrets are absent,
`electron-builder` skips signing and produces the same unsigned builds as today.
Add the secrets below and releases sign automatically - no code changes needed
(except the one macOS notarization flip noted).

All secrets go in: repo **Settings -> Secrets and variables -> Actions -> New
repository secret**.

## macOS (Apple Developer ID, ~$99/yr)

1. In your Apple Developer account, create a **Developer ID Application**
   certificate and export it from Keychain Access as a `.p12` (set a password).
2. Base64-encode it:
   ```
   base64 -i DeveloperID.p12 | pbcopy
   ```
3. Add these secrets:
   - `MAC_CSC_LINK` = the base64 string from step 2
   - `MAC_CSC_KEY_PASSWORD` = the `.p12` password
4. For notarization (needed to fully clear Gatekeeper), create an
   **app-specific password** at <https://appleid.apple.com> and add:
   - `APPLE_ID` = your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` = the app-specific password
   - `APPLE_TEAM_ID` = your 10-character Team ID
5. Turn notarization on: in `package.json` under `build.mac`, change
   `"notarize": false` to `"notarize": true`. (It is `false` so dormant builds
   never attempt to notarize without credentials.)

Verify after a build: `codesign -dv --verbose=4 Nowtify.app` and
`spctl -a -vvv -t install Nowtify.app` (should report "accepted / Developer ID").

## Windows (OV code-signing certificate, ~$200-400/yr)

1. Obtain an **OV** code-signing certificate as a `.pfx`. (EV certificates live
   on a hardware token and need a cloud-signing service to work in CI; OV `.pfx`
   is the straightforward route.)
2. Base64-encode it:
   ```
   base64 -i cert.pfx | pbcopy
   ```
3. Add these secrets:
   - `WIN_CSC_LINK` = the base64 string
   - `WIN_CSC_KEY_PASSWORD` = the `.pfx` password

Verify after a build: right-click the `.exe` -> Properties -> Digital
Signatures (should list your certificate).

## How the dormancy works

- The workflow maps the per-OS secrets to electron-builder's `CSC_LINK` /
  `CSC_KEY_PASSWORD` (macOS runner reads `MAC_*`, Windows runner reads `WIN_*`).
- `CSC_IDENTITY_AUTO_DISCOVERY` is forced `false`, so with no `CSC_LINK` the
  build is reliably unsigned; with a `CSC_LINK` present, electron-builder signs
  from that certificate.
- Signing secrets are scoped to the electron-builder steps only, not exposed to
  `npm ci` / lint / test.

Once secrets are in place, trigger a `workflow_dispatch` run (Actions -> Release
-> Run workflow) to confirm signing works before cutting a real `v*` release.
