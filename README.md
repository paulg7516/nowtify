# Nowtify

Ambient alerts for Jira and Microsoft 365 on macOS.

Nowtify watches your Jira tickets and Microsoft 365 messages for the signals you've marked as urgent, and surfaces them as a thin colored pulse around the edge of your screen. Available when you want it, invisible when you don't. Lives in the menu bar. No dock icon, no browser tab, no dashboard.

Website: [paulg7516.github.io/nowtify](https://paulg7516.github.io/nowtify/)

## What it watches

You turn on the triggers that matter to you. Each one has its own color, its own watchlist, and its own threshold.

- **Major Incident.** Any Jira ticket flagged as a Major Incident. Lights up the moment one opens, stops when the flag is removed or you dismiss it.
- **SLA breach imminent.** Tickets assigned to people you're watching whose SLA is about to expire. You decide how close to the deadline counts as urgent.
- **SLA breached.** Tickets assigned to people you're watching whose SLA has already expired. Stays on until you dismiss it.
- **My pending approvals.** Jira Service Desk requests waiting on your approval. Only counts the ones assigned to you, not your whole team's queue.
- **Teams VIP messages.** Unread Teams chats from people you've added to your VIP list. Stops as soon as you read them.
- **Outlook email from watched senders.** Unread Outlook emails from people you've added to your VIP list. Stops as soon as you read them.

## Install

Download the latest `.dmg` from the [Releases page](https://github.com/paulg7516/nowtify/releases/latest).

1. Double-click the `.dmg` and drag Nowtify into your Applications folder.
2. The first time you run it, right-click the app and choose **Open** instead of double-clicking. macOS will warn you about an unidentified developer; click **Open**. You only have to do this once.
3. Nowtify lives in the menu bar. There's no dock icon.

To launch it automatically when you sign in: System Settings, General, Login Items, click `+`, and pick Nowtify.

## First-time setup

Open Settings from the menu bar icon.

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

- **Display.** Choose where the pulse renders: the screen edge, the menu-bar icon, or both. Same color either way.
- **Appearance.** Switch the Settings window and the menu-bar popover between light and dark. The screen-edge pulse is unaffected; it always shows in the trigger's color.
- **Triggers.** Turn each trigger on or off individually. Each one has its own color picker.
- **Snooze.** Right-click the menu-bar icon, pick "Until I resume" to silence the pulse, then "Resume now" when you're ready. Alerts still accumulate in the menu-bar popover while snoozed, so you can see what fired.
- **Dismiss.** Per ticket per condition. Dismissing the Major Incident on `INC-123` doesn't affect its SLA alerts.

## What's not implemented yet

Honest list of stuff that doesn't work yet, so you know what to expect:

- **Screen-share auto-hide.** If you share your whole desktop and a Major Incident fires, the border is visible to viewers. On the to-do list.
- **Central watchlist sync.** Your watchlist is local to each Mac. There's no shared "team watchlist" yet.
- **Windows.** Built and in final testing before release. Not downloadable yet; the macOS `.dmg` is the only published build for now.
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

Source available, no formal open-source license yet. Personal and internal use is fine. If you want to use this in a commercial product, open an issue and we'll talk.
