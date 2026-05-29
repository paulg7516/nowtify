# Nowtify Marketing Website - Design

**Date:** 2026-05-29
**Status:** Draft, awaiting user review
**Author:** Paul Gerios (via Claude Opus 4.7 brainstorming)

## Purpose

A public-facing marketing website for Nowtify - a free, open-source macOS menu-bar app that watches a user's Atlassian (Jira / JSM) and Microsoft 365 (Teams chat + Outlook mail) accounts for the specific signals they've marked as urgent, and surfaces them ambiently as a thin colored pulse around the screen edge.

The site has one primary job: **convert a stranger landing on the page into someone who has Nowtify installed and running**, despite the friction of an unsigned macOS binary.

### What Nowtify actually does (and how the site has to pitch it)

Nowtify is not "notifications for Jira." It's a different *category* of tool, and the website copy must lead with that distinction or the value will be lost.

**Two integrations, six trigger types:**

- **Atlassian (Jira / JSM)** - polled directly via Basic auth + API token:
  1. **Major Incident** - any open ticket flagged as a Major Incident across the instance
  2. **SLA breach imminent** - watched users' tickets with SLA remaining under a configurable threshold
  3. **SLA breached** - watched users' tickets whose SLA cycle has expired
  4. **My pending approvals** - JSM service-desk requests awaiting the signed-in user's approval
- **Microsoft 365** - polled via Microsoft Graph (OAuth 2.0 with PKCE, public-client desktop pattern):
  5. **Teams VIP message** - unread Teams chat messages from people the user has marked as VIPs
  6. **Outlook email from watched sender** - unread Outlook emails from specific people

**Peripheral, not foreground.** Every other tool in this space (notifications, badges, Slack pings, email banners) demands the user's attention by stealing focus. Nowtify inverts this: alerts live at the edge of the screen as a thin colored border that the user notices only if they want to. The signal is *available* but never *intrusive*. This is the entire pitch and has to dominate the hero.

**Per-trigger watchlists, not global.** Each trigger has its own list of users/groups to watch. "SLA breach for the L1 queue" and "Teams unread from my CTO" are separate scopes - the user is in control of what counts as urgent, the app vendor is not.

**Local-only, no cloud.** Credentials live in macOS Keychain via Electron `safeStorage`. Polling happens directly from the user's laptop to Atlassian and Microsoft. There is no Nowtify backend, no telemetry, no shared inbox.

**One surface, two systems.** A senior IT-ops engineer typically watches Jira for ticket urgency AND Teams/email for stakeholder urgency. Nowtify is the only ambient surface that consolidates both into a single colored pulse with a single tray popover.

## Audience

Strangers arriving from a shared link (Slack, Twitter, blog mention). Default assumption: skeptical, unfamiliar with the project, evaluating "is this worth my install effort?" in under 30 seconds.

Secondary audience: existing internal users sending the link to teammates.

## Goals

1. **Communicate the category** (peripheral-vision alerts, not notifications) in under 5 seconds via the hero.
2. **Communicate the scope** (Jira AND Microsoft 365, six trigger types, user-defined watchlists) in under 30 seconds via the features grid.
3. Make the download obvious and one-click.
4. Pre-empt the Gatekeeper-bypass failure mode that would otherwise kill ~80% of first installs.
5. Convey credibility (real product, local-only, open source) without overpromising or making it look enterprise-y.

## Non-goals

- Account creation, login, paywall - the app is free and config-only.
- Tracking pixels or analytics in v1.
- Multi-page docs site - the README in the repo is sufficient for now.
- Windows/Linux messaging - the app is macOS-only and the site will say so.
- Blog / changelog page - the GitHub releases page is the changelog.

## Hosting and deploy

- **Platform:** GitHub Pages, served from `main` branch `/docs` folder.
- **Setup:** One-time enable in repo Settings → Pages → Source = `main`, folder = `/docs`.
- **URL:** `https://paulg7516.github.io/nowtify/` (custom domain deferrable).
- **Build:** None. Single static HTML file.
- **CI:** None - Pages auto-rebuilds on push to `main`.

## File structure

```
docs/
  index.html       # entire site - HTML + inline <style> + inline <script>
```

That's the whole site. No CSS or JS in separate files (chosen over multi-file split because the site is one page and editing in one place is friction-free; trade-off is a ~30-50KB single file, which is still smaller than a typical hero image and loads in one request).

## Page sections (top to bottom)

### 1. Sticky nav

- Left: Notification-stack mark (three stacked indigo rounded rectangles, the chosen logo from `design/mockups.html` concept #12) + "Nowtify" wordmark.
- Right: three anchor links (How it works, Features, FAQ) + small secondary "Download" button.
- Visual: translucent white with `backdrop-filter: blur(12px)`, 1px bottom border on scroll.
- Mobile (<768px): collapses link group into a hamburger; mark + Download button stay visible.

### 2. Hero

- Eyebrow text: "Ambient alerts for macOS · Jira + Microsoft 365"
- H1: "The urgent stuff. At the edge of your screen."
- Subhead (2 sentences): "Nowtify watches your Jira tickets and Microsoft 365 messages for the signals you've marked as urgent, and surfaces them as a thin colored pulse around your screen. Available when you want it, invisible when you don't."
- Primary CTA: `↓ Download for macOS` button. Links to `https://github.com/paulg7516/nowtify/releases/latest/download/Nowtify-0.5.10-universal.dmg` (see "Download link strategy" below).
- Secondary line below CTA: "vX.Y.Z · ~173 MB · macOS 12+" - version + size populated at runtime from GitHub Releases API.
- Background visual: a faux laptop frame rendered in CSS, with a thin indigo border that pulses on a 4-second loop to demonstrate the core UX. No JS animation - pure CSS keyframes.

**Copy rationale:** the eyebrow names the platform and the two integrations so a skimmer immediately knows the scope. The H1 leads with the category insight (peripheral vision) rather than a feature. The subhead does the two-system consolidation pitch in one breath and ends with the philosophical hook ("invisible when you don't") that separates Nowtify from every notifications app.

### 3. How it works

Three numbered cards in a row (single column on mobile):

1. **Connect Jira and/or Microsoft 365** - small illustration showing the Atlassian + Microsoft logos side-by-side, joined to Nowtify. Copy: "Sign in with an Atlassian API token, Microsoft 365 (OAuth), or both. Credentials stay in your macOS Keychain."
2. **Tell Nowtify what's urgent to you** - illustration of a checklist with people + ticket categories. Copy: "Per-trigger watchlists. Pick which users' tickets count for SLA, which colleagues are Teams VIPs, which senders' emails matter."
3. **A pulse at the edge of your screen when it fires** - mini animated screen-border pulse (mirrors the hero visual at smaller scale). Copy: "No popups. No sounds. No dock badge. Just a thin colored glow you can look at when you want to."

Each card: 24px illustration → bold title → 2-3 line description.

### 4. Features grid

Two-part section.

**Part A - "Six things Nowtify can watch."** 3×2 grid (1×6 on mobile). Each card: small inline-SVG icon (in the source-system brand color), 1-line trigger title, 2-line description of the firing condition. Order leads with the highest-severity Jira triggers, then the messaging triggers.

1. **Major Incident** - "Any open ticket flagged as a Major Incident across your Jira instance. Fires instantly, clears when the flag drops or you dismiss it." Icon: red exclamation in a small frame.
2. **SLA breach imminent** - "Watched users' tickets whose SLA remaining time drops under a threshold you set (e.g. 30 minutes). Per-condition color." Icon: amber clock.
3. **SLA breached** - "Watched users' tickets whose SLA cycle has expired. Stays lit until you dismiss." Icon: red clock with strike.
4. **My pending approvals** - "JSM service-desk requests waiting on your approval. Counts only what's assigned to the signed-in user, not the whole queue." Icon: checkmark in indigo circle.
5. **Teams VIP messages** - "Unread Teams chat messages from people you've marked as VIPs. Threshold configurable; clears on read." Icon: Microsoft Teams purple glyph.
6. **Outlook email from watched senders** - "Unread Outlook emails from specific people. Same VIP pattern as Teams." Icon: Microsoft Outlook blue glyph.

**Part B - "What makes it different."** Three smaller pull-quote-style callouts below the grid, no icons, just bold lead phrases.

- **Ambient, not intrusive.** "A glow at the edge of your screen instead of a popup that steals focus."
- **You define urgent.** "Per-trigger watchlists let you pick who and what matters. No app vendor deciding for you."
- **Local-only, no cloud.** "Polls Atlassian and Microsoft directly from your laptop. No backend, no telemetry, no shared inbox."

### 5. FAQ + install

Accordion (`<details>` elements, native HTML, no JS framework).

- **(open by default)** "How do I install it?" - the right-click → Open → System-Settings-Open-Anyway Gatekeeper workflow, with a small inline CSS mockup of the macOS dialog and an arrow callout. This is the most important content on the page.
- "What do I connect it to?" - "Atlassian (Jira or Jira Service Management) via an API token, and/or Microsoft 365 via OAuth (Teams chat + Outlook mail). You can use just one or both."
- "Do I need admin permissions?" - "For Atlassian: just your own user with an API token. For Microsoft 365: the current Nowtify build is registered as a single-tenant Entra app in the author's organization, which means M365 sign-in only works for users in that tenant today. **A multi-tenant build is on the roadmap** so any Microsoft 365 user can connect; until then the Jira side works for everyone, the M365 side does not. The site should make this explicit on the M365 feature cards (badge: 'limited availability') and in this FAQ entry."
- "Is this safe to install?" - unsigned ≠ malicious, source is on GitHub, link to repo.
- "What does it do with my data?" - "Everything stays local. Atlassian tokens and Microsoft refresh tokens are stored in your macOS Keychain via Electron `safeStorage`. Polling happens from your laptop directly to Atlassian and Microsoft. There is no Nowtify backend, no telemetry, no analytics."
- "Why isn't it code-signed?" - honest answer about Apple Developer ID being $99/yr and not yet justified for a free tool.
- "Windows or Linux?" - "macOS only. The peripheral-pulse UX is built on top of macOS-specific window-level APIs (transparent click-through always-on-top windows per display). No roadmap commitment for other platforms."
- "How do I uninstall?" - drag from /Applications + delete `~/Library/Application Support/Nowtify`.

### 6. Footer

Single row, three columns:

- Left: small mark + "Nowtify is free and open source."
- Center: link to GitHub repo, link to releases page.
- Right: copyright year + "made by Paul Gerios".

## Visual system

### Typography

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- No web fonts (faster load, matches the native macOS aesthetic of the app itself).
- H1: 64-72px desktop, 40px mobile, weight 600, tracking `-0.03em`
- H2: 40px desktop, 28px mobile, weight 600
- Body: 16px, weight 400, line-height 1.6
- Eyebrow / small caps labels: 12px, weight 600, `letter-spacing: 0.12em`, uppercase

### Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fafafa` | Page background |
| `--surface` | `#ffffff` | Cards, accordion items |
| `--ink` | `#0a0a0a` | Primary text, headlines |
| `--ink-2` | `#525252` | Secondary text |
| `--border` | `#e5e5e5` | Card borders, dividers |
| `--accent` | `#4f46e5` | Mark, CTA button, pulse animation |
| `--accent-pink` | `#ec4899` | Reserved for hero pulse gradient end only |

### Spacing

- 8px base scale.
- Section vertical padding: 160px desktop / 96px mobile.
- Max content width: 1120px.
- Cards: 32px internal padding, 24px gap between cards.

### Motion

- Hero pulse: CSS `@keyframes` on the laptop-frame border. 4-second loop, opacity 0 → 1 → 0 with a subtle scale.
- Card hover: `transform: translateY(-2px)` over 200ms ease.
- Accordion: native `<details>` toggle (no custom animation in v1).
- Respect `prefers-reduced-motion: reduce` - disable the hero pulse, keep static.

### Responsive

- Single breakpoint at 768px.
- Mobile: hamburger nav (CSS-only via `<input type="checkbox">` trick), 1-column sections, hero H1 drops to 40px, sticky CTA stays visible.

## Download link strategy

Primary CTA links to:

```
https://github.com/paulg7516/nowtify/releases/latest/download/Nowtify-0.5.10-universal.dmg
```

**Problem:** the `/latest/download/` redirect uses the exact filename of the asset in the latest release. The filename includes the version (e.g. `Nowtify-0.5.10-universal.dmg`), so when v0.5.11 ships, the link breaks because v0.5.11 has a different filename.

**Solution:** at page load, fetch `https://api.github.com/repos/paulg7516/nowtify/releases/latest`, extract the `.dmg` asset's `browser_download_url`, and patch the CTA's `href`. Fall back to a hardcoded link to the releases page (`https://github.com/paulg7516/nowtify/releases/latest`) if the API call fails (rate limit, offline, etc.).

Also use the same API call to populate the version + file size string under the CTA.

API response is cached by the browser for 60s by default; for a static one-page site this is fine.

## Error handling

- **GitHub API unavailable:** fall back to a hardcoded "v0.5.10 - 173 MB - macOS 12+" string and point the CTA at `releases/latest` (which the user can navigate manually).
- **JS disabled:** the CTA href is set in HTML to a sensible fallback (`releases/latest` page), so the page degrades gracefully.
- **Old browsers without `<details>` support:** all FAQ content renders open by default - still readable.
- **No reduced-motion preference respected:** the pulse animation is the only motion, and it's slow + small. Acceptable.

## What gets tested

For a static HTML site, "testing" is lightweight:

1. **Visual sanity:** open `docs/index.html` directly in a browser at desktop and mobile widths.
2. **Link check:** click every link, confirm none 404.
3. **Download CTA:** confirm the API call populates version + size, confirm the button href points at a working `.dmg` URL.
4. **Reduced-motion:** macOS Settings → Accessibility → Display → Reduce motion, reload, confirm hero pulse is static.
5. **No-JS path:** disable JS in browser DevTools, confirm page still loads and CTA still works (degraded).

No automated test suite. The site is small enough that visual inspection catches regressions.

## Known gap: Microsoft 365 multi-tenancy

The current Nowtify OAuth flow is hard-coded to a single Entra tenant (the author's org). External users will not be able to sign in to Microsoft 365 from the public download until the app registration is converted to multi-tenant. The website should reflect this honestly:

- The hero eyebrow stays "Jira + Microsoft 365" (we are not removing M365 from the pitch).
- The M365 feature cards (Teams, Outlook) carry a small "Limited availability" pill.
- The FAQ "Do I need admin permissions?" entry explains the situation.
- The "How it works" Step 1 says "Connect Jira today, Microsoft 365 if you're in a supported tenant (multi-tenant coming soon)."

This is a product follow-up to track separately from the website work, but the website must not over-promise.

## Out of scope (deferred for later)

- Custom domain (e.g. `nowtify.app`)
- Analytics
- Internationalization
- Dark mode (light-only for v1; matches the brand reference site aesthetics)
- A blog/changelog page
- Screenshots of the real app (using CSS mockups instead)
