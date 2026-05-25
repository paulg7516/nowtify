# Nowtify

Ambient JSM alert overlay for a fully-remote IT ops team. Renders a thin colored border around every screen on every laptop, polling JSM for the watch list of users you care about. Two trigger families:

- **Major Incident = true** on any watched user's open ticket → solid red flash.
- **SLA condition met** (e.g. "Time to resolution" remaining < 30 min, or breached) → flash in the color you set per condition.

Lives in the macOS menu bar. No browser tab, no dashboard.

## Setup

1. **Install Node 20+ and clone this repo.**

2. **Install deps:**

   ```sh
   npm install
   ```

3. **Create an Atlassian API token:**

   - Visit `https://id.atlassian.com/manage-profile/security/api-tokens`
   - Click **Create API token**, copy it.

4. **Run the app:**

   ```sh
   npm start
   ```

   On first launch the settings window opens automatically.

5. **In Settings:**

   - **Site URL:** `https://your-company.atlassian.net`
   - **Account email:** the email of the Atlassian account that owns the API token
   - **API token:** paste it
   - Click **Test connection** - you should see "Connected as Your Name".
   - Click **Detect fields now** - this auto-discovers your Major Incident custom field and SLA fields. If your Major Incident field is named something other than literally "Major Incident", paste its field ID (e.g. `customfield_10210`) into the override box.
   - **Search and add** the users you want to watch (yourself counts - add yourself).
   - Tune SLA conditions and colors as needed.
   - Click **Save & apply**.

## How it works

- **`AlertEngine`** polls JSM every N seconds. JQL: `assignee in (...) AND statusCategory != Done`. Reads Major Incident + SLA custom fields off each returned issue. Evaluates each trigger condition. Computes overall overlay state (highest-severity alert wins, pulsing if any alert pulses).
- **`OverlayWindows`** creates one transparent click-through always-on-top BrowserWindow per display. CSS-only border with an optional pulse animation. Receives state updates over IPC.
- **`TrayManager`** lives in the menu bar. Status dot reflects current state (green idle, red alerting, yellow snoozed). Left-click opens a popover listing each triggering ticket - click a ticket key to open it in your browser. Right-click for the full menu (Snooze, Clear dismissals, Settings, Quit).
- **`store.js`** persists config + snooze + dismissal state via `electron-store` (JSON file in your app data dir).

## Trigger rules

- A Major Incident alert fires the moment the field flips to `true` and stays until either the field flips back to `false` *or* you dismiss it.
- An SLA alert fires when remaining time on any ongoing SLA cycle drops below a condition's `thresholdMinutes`. A condition with `thresholdMinutes = 0` matches breached cycles only.
- **Dismiss** is per `(ticket, condition)` - dismissing the Major Incident on `INC-123` doesn't affect its SLA alerts.
- **Snooze** suppresses the overlay border entirely for the chosen duration. Alerts still accumulate in the popover so you can see what fired while snoozed.

## Notes / known POC limits

- Single user, single machine: each agent runs their own copy with their own API token. There is no central poller - the app talks to JSM directly.
- Screen-share auto-hide is **not implemented**. If you share your whole desktop and a P1 fires, the border is visible to viewers. Deferred until POC validates.
- No central watch-list sync - your watch list is local to each install.
- Tested only on macOS. Tray icon uses macOS named system images (`NSStatusAvailable`/`NSStatusUnavailable`/`NSStatusPartiallyAvailable`); on other platforms the tray icon will be blank until a fallback is added.

## Distributing to your team

### Build the `.dmg` (unsigned, for internal use)

```sh
npm run dist
```

Produces `dist/Nowtify-<version>-universal.dmg` (universal binary: Intel + Apple Silicon). AirDrop or email to each agent.

### What each agent does on first install

1. Double-click the `.dmg`, drag **Nowtify** to Applications.
2. First launch: **right-click → Open** (don't double-click). macOS will warn about an unidentified developer; click **Open**. This is a one-time bypass.
3. App lives in the menu bar (no dock icon).
4. Open Settings (right-click tray → Settings…) and enter:
   - JSM site URL, email, Atlassian API token (each agent makes their own at id.atlassian.com)
   - Click **Detect fields**
   - Add themselves (and any teammates / groups) to the watch list
5. **Auto-launch on login:** System Settings → General → Login Items → click `+` → pick **Nowtify**.

### Auto-updates (via electron-updater)

To enable automatic update delivery:

Publish target is already configured in `package.json` for `paulg7516/nowtify`.

1. **Generate a GitHub Personal Access Token** with `repo` scope. Export as env var when releasing:
   ```sh
   export GH_TOKEN=ghp_xxx
   npm run release
   ```
   This builds the DMG, uploads it as a GitHub release asset, and publishes release metadata.
2. **On each agent's machine:** the app checks for updates on launch and every 6 hours. When a new version is available, it downloads in the background and prompts the user to restart.

Note: auto-updates work fine for unsigned macOS apps as long as the app is installed in `/Applications`.

### Going further

- **Apple Developer signing + notarization** ($99/year) removes the right-click-Open step entirely. Worth it if this rolls out beyond the team.
- **MDM push** (Intune / Jamf / Kandji): if you have MDM, push the unsigned `.dmg` silently and whitelist the binary to skip Gatekeeper.

## Layout

```
src/
├── main/
│   ├── index.js              # Electron entrypoint, IPC wiring
│   ├── alert-engine.js       # Polling loop + trigger evaluation + state machine
│   ├── jsm-client.js         # JSM REST client (auth, search, fields, JQL)
│   ├── overlay-windows.js    # Per-display transparent border windows
│   ├── tray-manager.js       # Menu bar tray + popover window
│   └── store.js              # Persistent config via electron-store
├── preload/
│   ├── overlay-preload.js
│   ├── settings-preload.js
│   └── popover-preload.js
└── renderer/
    ├── overlay/              # Border (transparent click-through)
    ├── settings/             # First-run + ongoing config UI
    └── popover/              # Triggering tickets list (under tray icon)
```
