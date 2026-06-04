# Nowtify for Windows - Test Build

Thanks for helping test the first Windows build of Nowtify. This is an early,
**unsigned** test build, so Windows shows a safety warning the first time you
launch it (steps below). That warning is expected and safe to click through.

## What you need
- Windows 10 or 11 (64-bit)
- Your Jira (JSM) login and the ability to create an Atlassian API token
- Optional: your Microsoft 365 account, to test Teams and Outlook alerts

## Install
1. Download **Nowtify Setup 0.5.27.exe**.
2. Double-click it. Windows SmartScreen may say "Windows protected your PC."
3. Click **More info**, then **Run anyway**. (This appears only because the app
   is not code-signed yet - it is safe to run.)
4. Nowtify installs and starts on its own.

## Where did it go?
Nowtify has no window and no taskbar button - it lives in the **system tray**
(the small icons next to the clock, bottom-right). You may need to click the
**^** arrow to show hidden icons. Click the Nowtify icon to open it.

## First-time setup
1. Click the tray icon, then **Settings**.
2. On the **Integrations** panel, enter your Jira **Site URL**
   (for example, https://xolv.atlassian.net/), your **email**, and an
   **API token** (Settings has a link to create one), then click **Connect**.
3. Optional: click **Connect Microsoft 365** to turn on Teams and Outlook
   alerts. A browser tab opens for sign-in and then returns to the app.

## What to check
Please try each item and note anything that does not work:

- [ ] The app installed and the tray icon appears
- [ ] Clicking the tray icon opens the popover, and there is no taskbar button
- [ ] Settings connects to Jira, and still shows "Connected" after you quit and
      reopen the app
- [ ] Microsoft 365 sign-in completes and lands you back in the app
- [ ] You get a Windows notification when an alert fires
- [ ] When something is alerting, a colored glow pulses around the edge of the
      screen, and you can still click things behind it
- [ ] The tray icon changes color depending on what is alerting

## How to report
Send what worked and what did not to **[your contact or channel here]**, with a
screenshot if you can. Mention your Windows version (10 or 11) - it helps.

Thanks again for testing.
