# Nowtify Marketing Website - Design

**Date:** 2026-05-29
**Status:** Draft, awaiting user review
**Author:** Paul Gerios (via Claude Opus 4.7 brainstorming)

## Purpose

A public-facing marketing website for Nowtify - a free, open-source macOS menu-bar app that polls Jira Service Management and pulses a thin colored border around the user's screen when watched conditions trigger.

The site has one primary job: **convert a stranger landing on the page into someone who has Nowtify installed and running**, despite the friction of an unsigned macOS binary.

## Audience

Strangers arriving from a shared link (Slack, Twitter, blog mention). Default assumption: skeptical, unfamiliar with the project, evaluating "is this worth my install effort?" in under 30 seconds.

Secondary audience: existing internal users sending the link to teammates.

## Goals

1. Communicate what Nowtify does in under 10 seconds (screen-border ambient alerts for Jira).
2. Make the download obvious and one-click.
3. Pre-empt the Gatekeeper-bypass failure mode that would otherwise kill ~80% of first installs.
4. Convey credibility (real product, not vapor) without overpromising.

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

- Eyebrow text: "Ambient Jira alerts for macOS"
- H1: "Alerts you can't miss. Without the noise."
- Subhead (2 sentences): Explains the screen-border idea and how it stays out of your workflow.
- Primary CTA: `↓ Download for macOS` button. Links to `https://github.com/paulg7516/nowtify/releases/latest/download/Nowtify-0.5.10-universal.dmg` (see "Download link strategy" below).
- Secondary line below CTA: "vX.Y.Z · ~173 MB · macOS 12+" - version + size populated at runtime from GitHub Releases API.
- Background visual: a faux laptop frame rendered in CSS, with a thin indigo border that pulses on a 4-second loop to demonstrate the core UX. No JS animation - pure CSS keyframes.

### 3. How it works

Three numbered cards in a row (single column on mobile):

1. **Install + connect Jira** - small illustration of a key/token icon
2. **Pick what to watch** - illustration of a checkbox list
3. **See alerts at the edge of your screen** - mini animated screen-border pulse

Each card: 24px illustration → bold title → 2-line description.

### 4. Features grid

3×2 grid (1×6 on mobile). Each card: inline SVG icon + 1-line title + 2-line description.

1. Major Incident detection
2. SLA breach warnings
3. Approvals queue ("my pending approvals")
4. Teams VIP messages (unread from people you care about)
5. Outlook unread (from specific senders)
6. Quiet by design (no popups, no notification spam)

### 5. FAQ + install

Accordion (`<details>` elements, native HTML, no JS framework).

- **(open by default)** "How do I install it?" - the right-click → Open → System-Settings-Open-Anyway Gatekeeper workflow, with a small inline CSS mockup of the macOS dialog and an arrow callout. This is the most important content on the page.
- "Is this safe to install?" - explain unsigned ≠ malicious, link to repo source.
- "What does it do with my data?" - all credentials stored locally via Keychain (electron `safeStorage`), no telemetry, no remote servers.
- "Why isn't it code-signed?" - honest answer about Apple Developer ID being $99/yr and not yet justified for a free tool.
- "Windows or Linux?" - currently macOS-only, no roadmap commitment.
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

## Out of scope (deferred for later)

- Custom domain (e.g. `nowtify.app`)
- Analytics
- Internationalization
- Dark mode (light-only for v1; matches the brand reference site aesthetics)
- A blog/changelog page
- Screenshots of the real app (using CSS mockups instead)
