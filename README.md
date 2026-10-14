# Nowtify

Ambient alerts for Jira and Microsoft 365 on macOS and Windows.

Nowtify watches your Jira tickets and Microsoft 365 messages for the signals you've marked as urgent, and surfaces them as a thin colored pulse around the edge of your screen. Available when you want it, invisible when you don't. Lives in the menu bar (Mac) or system tray (Windows). No dock icon, no browser tab, no dashboard.

Website: [paulg7516.github.io/nowtify](https://paulg7516.github.io/nowtify/)

## What it watches

You turn on the triggers that matter to you. Each one has its own color, its own watchlist, and its own threshold.

- **Major Incident.** Any Jira ticket flagged as a Major Incident. Lights up the moment one opens, stops when the ticket resolves or the flag is removed. Acknowledge it to stop the pulse sooner.
- **SLA breach imminent.** Tickets assigned to people you're watching whose SLA is about to expire. You decide how close to the deadline counts as urgent.
- **SLA breached.** Tickets assigned to people you're watching whose SLA has already expired. Stays on until the ticket resolves or you acknowledge it.
- **My pending approvals.** Jira Service Desk requests waiting on your approval. Only counts the ones assigned to you, not your whole team's queue.
- **Teams VIP messages.** Unread Teams chats from people you've added to your VIP list. Stops as soon as you read them.
- **Outlook email from watched senders.** Unread Outlook emails from people you've added to your VIP list. Stops as soon as you read them.

## Install

Download the latest build from the [Releases page](https://github.com/paulg7516/nowtify/releases/latest).

**Mac** (`.dmg`)

1. Double-click the `.dmg` and drag Nowtify into your Applications folder.
2. The first time you run it, macOS warns about an unidentified developer. Right-click the app and choose **Open**, then **Open** again. On newer macOS versions, if there's no Open button, go to System Settings, Privacy & Security, and click **Open Anyway**. You only have to do this once.
3. Nowtify lives in the menu bar. There's no dock icon.

**Windows**

- `Nowtify-Setup-<version>.exe`: install it yourself. It installs for your account only and updates itself. If Windows SmartScreen warns you, click **More info**, then **Run anyway**.
- `Nowtify-<version>.msi`: for IT to deploy to many machines (for example through Intune). It installs for the whole machine; IT rolls out new versions.

Nowtify lives in the system tray (you may need to click the `^` arrow to see it).

Nowtify starts automatically when you sign in. Turn that off in Settings with **Launch at login**.

## First-time setup

Open Settings from the Nowtify icon (menu bar on Mac, system tray on Windows).

**For Jira:**

1. Create an Atlassian API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. In Settings, enter your Atlassian site URL (like `your-company.atlassian.net`), the email of the account that owns the token, and paste the token.
3. Click **Test connection**. You should see "Connected as Your Name".
4. Click **Detect fields**. This auto-discovers your Major Incident custom field and SLA fields. If your Major Incident field has a custom name, paste its field ID (like `customfield_10210`) into the override box.
5. Search for and add the people whose tickets count as urgent. You can watch yourself, individual teammates, or whole groups.

**For Microsoft 365:**

1. Click **Connect** in the Microsoft Teams card. Sign in to your work account in the popup.
2. Search for and add the colleagues whose unread Teams messages should fire an alert.
3. Same for Outlook senders whose unread emails should fire an alert.

Save and you're done. Nowtify polls every 30 seconds and pulses the screen edge in the trigger's color when something matches.

## Settings you'll want to know about

- **Display.** Choose where the pulse renders: the screen edge, the Nowtify icon, or both. Same color either way.
- **Appearance.** Switch the Settings window and the alert list between light and dark. The screen-edge pulse is unaffected; it always shows in the trigger's color.
- **Triggers.** Turn each trigger on or off individually. Each one has its own color picker.
- **Pause.** Right-click the Nowtify icon, pick **Pause pulse alerts**, and choose how long (or "Until I resume"). Alerts still collect in the alert list while paused, so you can see what fired.
- **Acknowledge.** For long-running Major Incidents and SLA alerts. Click Acknowledge on a row in the alert list and that alert stops pulsing on both the screen edge and the Nowtify icon, so other alerts show through. It stays in the list, dimmed, until the ticket resolves; click Acknowledged to undo. Per ticket per condition: acknowledging the Major Incident on `INC-123` doesn't affect its SLA alerts.
- **Alert list size.** Drag any edge of the alert list to resize it. Nowtify remembers the size.
- **Screen sharing.** The screen-edge pulse is hidden from screen shares and recordings, so the people watching don't see it. Windows needs Windows 10 (version 2004) or later for this; on older versions the pulse still shows in shares.

## What's not implemented yet

Honest list of stuff that doesn't work yet, so you know what to expect:

- **Central watchlist sync.** Your watchlist is local to each computer. There's no shared "team watchlist" yet.
- **Linux.** Not planned. The peripheral-pulse experience is built on platform-specific window APIs.

## Building from source

You'll need Node 20 or newer.

```sh
git clone https://github.com/paulg7516/nowtify.git
cd nowtify
npm install
npm start
```

To build a `.dmg`:

```sh
npm run dist
```

Output lands in `dist/Nowtify-<version>-universal.dmg` (a universal binary that runs on Intel and Apple Silicon).

To cut a release (requires push access + a GitHub Personal Access Token in `GH_TOKEN`):

```sh
npm run ship           # patch bump
npm run ship:minor     # minor bump
```

This bumps the version, builds, publishes the release to GitHub, and pushes the source. Auto-updates work for unsigned macOS apps as long as the app is installed in `/Applications`.

## How it's organized

```
src/
├── main/
│   ├── index.js              # Electron entrypoint, IPC wiring
│   ├── alert-engine.js       # Polling loop, trigger evaluation, state machine
│   ├── jsm-client.js         # Jira REST client (auth, search, fields, JQL)
│   ├── ms-graph-client.js    # Microsoft Graph client (Teams + Outlook)
│   ├── overlay-windows.js    # Per-display transparent border windows
│   ├── tray-manager.js       # Menu-bar tray + popover
│   └── store.js              # Persistent config via electron-store
├── preload/
│   ├── overlay-preload.js
│   ├── settings-preload.js
│   └── popover-preload.js
└── renderer/
    ├── overlay/              # Border (transparent click-through)
    ├── settings/             # First-run and ongoing config UI
    └── popover/              # Menu-bar popover (alerts list)
```

## Contributing

Bug reports and feature requests welcome on the [issue tracker](https://github.com/paulg7516/nowtify/issues). If you're sending a pull request, please run the linter and tests first:

```sh
npm run lint
npm test
```

Both are part of the pre-ship gate so a PR that doesn't pass them won't be releasable anyway.

## License

Copyright © 2026 Paul Gerios. All rights reserved.

Nowtify is proprietary software - it is **not** open source. The source is public for transparency, but that does not grant a license to use it: no permission is given to copy, modify, redistribute, or use Nowtify commercially without a written license from the copyright holder. For licensing inquiries, open an issue on this repository.
