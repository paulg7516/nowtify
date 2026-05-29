# Nowtify Marketing Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page marketing/download site for Nowtify at `docs/index.html`, deployed via GitHub Pages from `main` branch.

**Architecture:** One self-contained HTML file with inline CSS and JS. No build step. CSS variables for tokens, system font stack, native `<details>` for the FAQ accordion, vanilla `fetch` against the GitHub Releases API for dynamic download URL + version/size. Single 768px breakpoint for mobile. CSS keyframes for the hero pulse animation.

**Tech Stack:** HTML5, CSS3 (custom properties, `clamp()` for fluid type, `@keyframes`, `backdrop-filter`), vanilla ES2020 JS, GitHub Pages.

**Spec reference:** `docs/superpowers/specs/2026-05-29-nowtify-website-design.md`

**Verification approach:** This is a static marketing site. The skill defaults to TDD but unit testing a one-page HTML file is the wrong tool. Each task ends with a *visual verification* step — open `docs/index.html` in a browser and confirm the new section renders correctly at both desktop (1280px) and mobile (375px) widths. A single automated smoke test in Task 13 confirms the download-link patcher logic.

---

## File Structure

| Path | Purpose | Created in task |
|------|---------|----------------|
| `docs/index.html` | The entire site (HTML + inline CSS + inline JS) | Task 1 |
| `docs/.nojekyll` | Tells GitHub Pages not to run Jekyll over the directory | Task 1 |
| `tests/website-download-patcher.test.js` | Single smoke test for the GitHub API patcher logic | Task 13 |

The whole site is one file because: (a) it is one page, (b) editing-in-one-place is friction-free, (c) the resulting ~40 KB file loads in one request and one parse. If the site ever grows past 3-4 sections of additional content, revisit and split.

---

## Task 1: Skeleton + GitHub Pages setup

**Files:**
- Create: `docs/index.html`
- Create: `docs/.nojekyll`

- [ ] **Step 1: Create `docs/.nojekyll`**

GitHub Pages runs Jekyll by default, which can mangle filenames starting with `_`. We do not use Jekyll, so disable it with an empty marker file.

```bash
touch docs/.nojekyll
```

- [ ] **Step 2: Create `docs/index.html` with HTML5 skeleton, `<head>` metadata, and root CSS tokens**

Write the file with this exact content:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nowtify - Ambient alerts for Jira and Microsoft 365</title>
<meta name="description" content="Free macOS menu-bar app. Watches your Jira tickets and Microsoft 365 messages, surfaces what's urgent as a thin pulse around your screen.">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><rect x='32' y='34' width='56' height='11' rx='3' fill='%234f46e5' opacity='.28'/><rect x='26' y='52' width='68' height='14' rx='3.5' fill='%234f46e5' opacity='.55'/><rect x='20' y='72' width='80' height='20' rx='5' fill='%234f46e5'/></svg>">
<style>
  :root {
    --bg: #fafafa;
    --surface: #ffffff;
    --ink: #0a0a0a;
    --ink-2: #525252;
    --ink-3: #737373;
    --border: #e5e5e5;
    --border-strong: #d4d4d4;
    --accent: #4f46e5;
    --accent-soft: #eef2ff;
    --accent-pink: #ec4899;
    --teams: #6264a7;
    --outlook: #0078d4;
    --red: #ef4444;
    --amber: #f59e0b;
    --green: #10b981;
    --maxw: 1120px;
    --pad-x: clamp(20px, 5vw, 48px);
    --section-y: clamp(96px, 14vw, 160px);
    --radius: 14px;
    --radius-sm: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    color: var(--ink);
    background: var(--bg);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  a { color: inherit; text-decoration: none; }
  img, svg { display: block; max-width: 100%; }
  button { font: inherit; cursor: pointer; }

  .container {
    max-width: var(--maxw);
    margin: 0 auto;
    padding-left: var(--pad-x);
    padding-right: var(--pad-x);
  }
</style>
</head>
<body>
<!-- nav goes here -->
<!-- hero goes here -->
<!-- how-it-works goes here -->
<!-- features goes here -->
<!-- faq goes here -->
<!-- footer goes here -->
<script>
  /* download patcher goes here */
</script>
</body>
</html>
```

- [ ] **Step 3: Verify in browser**

```bash
open docs/index.html
```

Expected: a blank near-white page (no content yet) with the Nowtify favicon visible in the tab. The window title should read "Nowtify - Ambient alerts for Jira and Microsoft 365".

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/.nojekyll
git commit -m "feat(site): scaffold static site at docs/ with CSS tokens"
```

---

## Task 2: Sticky nav

**Files:**
- Modify: `docs/index.html` — replace `<!-- nav goes here -->` with the nav markup; append nav CSS to the `<style>` block

- [ ] **Step 1: Replace `<!-- nav goes here -->` with this markup**

```html
<header class="nav" id="siteNav">
  <div class="container nav-inner">
    <a class="nav-brand" href="#top" aria-label="Nowtify home">
      <svg class="nav-mark" viewBox="0 0 120 120" aria-hidden="true">
        <rect x="32" y="34" width="56" height="11" rx="3" fill="#4f46e5" opacity="0.28"/>
        <rect x="26" y="52" width="68" height="14" rx="3.5" fill="#4f46e5" opacity="0.55"/>
        <rect x="20" y="72" width="80" height="20" rx="5" fill="#4f46e5"/>
      </svg>
      <span class="nav-wordmark">Nowtify</span>
    </a>
    <input type="checkbox" id="navToggle" class="nav-toggle" aria-label="Toggle navigation">
    <label for="navToggle" class="nav-burger" aria-hidden="true">
      <span></span><span></span><span></span>
    </label>
    <nav class="nav-links">
      <a href="#how">How it works</a>
      <a href="#features">Features</a>
      <a href="#faq">FAQ</a>
      <a href="#download" class="nav-cta">Download</a>
    </nav>
  </div>
</header>
```

- [ ] **Step 2: Append nav styles to the `<style>` block** (immediately before `</style>`)

```css
  .nav {
    position: sticky;
    top: 0;
    z-index: 50;
    background: rgba(250, 250, 250, 0.7);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid transparent;
    transition: border-color 200ms ease;
  }
  .nav.scrolled { border-bottom-color: var(--border); }
  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 14px;
    padding-bottom: 14px;
  }
  .nav-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .nav-mark { width: 28px; height: 28px; }
  .nav-wordmark { font-size: 18px; }
  .nav-links {
    display: flex;
    align-items: center;
    gap: 28px;
    font-size: 14px;
    color: var(--ink-2);
  }
  .nav-links a:hover { color: var(--ink); }
  .nav-cta {
    background: var(--ink);
    color: var(--bg) !important;
    padding: 8px 14px;
    border-radius: 999px;
    font-weight: 500;
  }
  .nav-cta:hover { background: var(--accent); color: #fff !important; }
  .nav-toggle, .nav-burger { display: none; }

  @media (max-width: 768px) {
    .nav-burger {
      display: inline-flex;
      flex-direction: column;
      justify-content: space-between;
      width: 22px;
      height: 16px;
      cursor: pointer;
    }
    .nav-burger span {
      display: block;
      height: 2px;
      background: var(--ink);
      border-radius: 2px;
      transition: transform 200ms ease, opacity 200ms ease;
    }
    .nav-links {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      flex-direction: column;
      gap: 0;
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border);
      padding: 12px var(--pad-x) 20px;
      max-height: 0;
      overflow: hidden;
      transition: max-height 240ms ease;
    }
    .nav-links a { padding: 12px 0; font-size: 15px; }
    .nav-toggle:checked ~ .nav-links { max-height: 360px; }
    .nav-toggle:checked ~ .nav-burger span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .nav-toggle:checked ~ .nav-burger span:nth-child(2) { opacity: 0; }
    .nav-toggle:checked ~ .nav-burger span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
  }
```

- [ ] **Step 3: Append a tiny scroll-listener script** to the `<script>` block

```javascript
  const navEl = document.getElementById('siteNav');
  window.addEventListener('scroll', () => {
    navEl.classList.toggle('scrolled', window.scrollY > 8);
  }, { passive: true });
```

- [ ] **Step 4: Verify in browser**

Reload `docs/index.html`. Expected: sticky white-translucent nav at the top with the logo + wordmark on the left, three text links + a black pill "Download" button on the right. Scroll the (empty) page — the nav stays put and a 1px gray bottom border appears after 8px of scroll. Resize the window below 768px — the right-side links collapse into a hamburger that toggles a dropdown.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add sticky nav with mobile hamburger"
```

---

## Task 3: Hero (markup + static styling)

**Files:**
- Modify: `docs/index.html` — replace `<!-- hero goes here -->`; append hero CSS

- [ ] **Step 1: Replace `<!-- hero goes here -->` with hero markup**

```html
<section class="hero" id="top">
  <div class="container hero-inner">
    <p class="eyebrow">Ambient alerts for macOS · Jira + Microsoft 365</p>
    <h1 class="hero-title">The urgent stuff.<br>At the edge of your screen.</h1>
    <p class="hero-sub">
      Nowtify watches your Jira tickets and Microsoft 365 messages for the signals you've marked as urgent, and surfaces them as a thin colored pulse around your screen. Available when you want it, invisible when you don't.
    </p>
    <div class="hero-cta" id="download">
      <a class="btn-primary" id="downloadBtn" href="https://github.com/paulg7516/nowtify/releases/latest" download>
        <span class="btn-arrow">↓</span> Download for macOS
      </a>
      <p class="hero-meta">
        <span id="downloadVersion">v0.5.10</span>
        <span class="dot">·</span>
        <span id="downloadSize">~173 MB</span>
        <span class="dot">·</span>
        <span>macOS 12+</span>
      </p>
    </div>

    <!-- faux laptop visual -->
    <div class="laptop">
      <div class="laptop-screen">
        <div class="laptop-pulse" aria-hidden="true"></div>
        <div class="laptop-content">
          <div class="laptop-menubar">
            <div class="laptop-menubar-left">
              <span class="apple">●</span>
              <span>Slack</span><span>Edit</span><span>View</span>
            </div>
            <div class="laptop-menubar-right">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <rect x="32" y="34" width="56" height="11" rx="3" fill="#4f46e5" opacity="0.28"/>
                <rect x="26" y="52" width="68" height="14" rx="3.5" fill="#4f46e5" opacity="0.55"/>
                <rect x="20" y="72" width="80" height="20" rx="5" fill="#4f46e5"/>
              </svg>
              <span>9:41</span>
            </div>
          </div>
        </div>
      </div>
      <div class="laptop-base"></div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append hero styles** (before `</style>`)

```css
  .hero {
    padding-top: clamp(56px, 9vw, 96px);
    padding-bottom: var(--section-y);
    text-align: center;
  }
  .hero-inner { display: flex; flex-direction: column; align-items: center; }
  .eyebrow {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-2);
    margin: 0 0 28px;
  }
  .hero-title {
    font-size: clamp(40px, 6.4vw, 72px);
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-weight: 600;
    margin: 0 0 24px;
    max-width: 900px;
  }
  .hero-sub {
    max-width: 640px;
    color: var(--ink-2);
    font-size: clamp(16px, 1.5vw, 19px);
    margin: 0 0 40px;
  }
  .hero-cta { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--ink);
    color: #fff !important;
    padding: 16px 28px;
    border-radius: 999px;
    font-weight: 500;
    font-size: 16px;
    transition: background 200ms ease, transform 200ms ease;
  }
  .btn-primary:hover { background: var(--accent); transform: translateY(-1px); }
  .btn-arrow { font-weight: 700; }
  .hero-meta {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-3);
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .hero-meta .dot { opacity: 0.5; }

  /* faux laptop */
  .laptop {
    margin-top: 80px;
    width: min(880px, 100%);
    position: relative;
  }
  .laptop-screen {
    aspect-ratio: 16 / 10;
    background: linear-gradient(180deg, #1c1c1e 0%, #0a0a0a 100%);
    border-radius: 14px 14px 4px 4px;
    padding: 10px;
    position: relative;
    overflow: hidden;
    box-shadow: 0 30px 80px -20px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.05);
  }
  .laptop-pulse {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: inset 0 0 0 3px transparent;
    animation: heroPulse 4s ease-in-out infinite;
  }
  @keyframes heroPulse {
    0%, 100% { box-shadow: inset 0 0 0 3px rgba(99, 102, 241, 0); }
    50% { box-shadow: inset 0 0 0 3px rgba(99, 102, 241, 0.85), inset 0 0 24px rgba(236, 72, 153, 0.35); }
  }
  @media (prefers-reduced-motion: reduce) {
    .laptop-pulse { animation: none; box-shadow: inset 0 0 0 3px rgba(99, 102, 241, 0.55); }
  }
  .laptop-content {
    width: 100%;
    height: 100%;
    background: #f5f5f7;
    border-radius: 6px 6px 2px 2px;
    overflow: hidden;
  }
  .laptop-menubar {
    height: 26px;
    background: rgba(255,255,255,0.85);
    border-bottom: 1px solid rgba(0,0,0,0.07);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-size: 12px;
    color: #1c1c1e;
    font-weight: 500;
  }
  .laptop-menubar-left, .laptop-menubar-right {
    display: flex; align-items: center; gap: 14px;
  }
  .laptop-menubar-right svg { width: 14px; height: 14px; }
  .laptop-menubar .apple { font-size: 11px; }
  .laptop-base {
    height: 14px;
    background: linear-gradient(180deg, #d4d4d8 0%, #a1a1aa 100%);
    margin: 0 auto;
    width: 88%;
    border-radius: 0 0 12px 12px;
  }
```

- [ ] **Step 3: Verify in browser**

Reload. Expected:
- Eyebrow uppercase label
- Large two-line headline
- Subhead paragraph
- Black pill download button with `↓ Download for macOS`
- Mono version meta line below
- A faux laptop with a tiny fake menubar (Apple, Slack, Edit, View on the left; Nowtify mark + 9:41 on the right). The screen edge pulses indigo→pink on a 4-second loop.
- Scroll to confirm the button is large and obvious.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add hero with pulsing-laptop visual + download CTA"
```

---

## Task 4: Download-link patcher (GitHub Releases API)

**Files:**
- Modify: `docs/index.html` — append to the `<script>` block

The hero `<a>` already has a working fallback `href` pointing at the releases page. This task replaces it dynamically at page load with the direct `.dmg` link and populates the version + size.

- [ ] **Step 1: Append the patcher script** (inside the existing `<script>` tag)

```javascript
  (async function patchDownload() {
    const btn = document.getElementById('downloadBtn');
    const vEl = document.getElementById('downloadVersion');
    const sEl = document.getElementById('downloadSize');
    try {
      const res = await fetch('https://api.github.com/repos/paulg7516/nowtify/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) return;
      const data = await res.json();
      const dmg = (data.assets || []).find(a => a.name.endsWith('.dmg'));
      if (!dmg) return;
      btn.setAttribute('href', dmg.browser_download_url);
      vEl.textContent = data.tag_name || data.name || vEl.textContent;
      const mb = (dmg.size / (1024 * 1024)).toFixed(0);
      sEl.textContent = `~${mb} MB`;
    } catch (_) {
      // Silent fallback: leave the hardcoded version + releases page href in place.
    }
  })();
```

- [ ] **Step 2: Verify in browser**

Reload `docs/index.html`. Open DevTools → Network. Confirm:
- One request to `api.github.com/repos/paulg7516/nowtify/releases/latest` returns 200.
- The button's `href` (inspect with DevTools Elements) updates to a `.dmg` URL like `https://github.com/paulg7516/nowtify/releases/download/v0.5.10/Nowtify-0.5.10-universal.dmg`.
- `#downloadVersion` shows `v0.5.10` (or whatever the latest is).
- `#downloadSize` shows `~173 MB` (approximately).

Then DevTools → Network → set Offline → reload. Confirm the button still points at `releases/latest` (the HTML fallback) and the hardcoded `v0.5.10 · ~173 MB` shows. No JS console errors.

- [ ] **Step 3: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): patch download CTA from GitHub Releases API at load"
```

---

## Task 5: "How it works" section

**Files:**
- Modify: `docs/index.html` — replace `<!-- how-it-works goes here -->`; append CSS

- [ ] **Step 1: Replace `<!-- how-it-works goes here -->` with markup**

```html
<section class="how" id="how">
  <div class="container">
    <p class="section-eyebrow">How it works</p>
    <h2 class="section-title">Three steps. Then you forget it's there.</h2>
    <ol class="how-grid">
      <li class="how-card">
        <div class="how-num">1</div>
        <div class="how-illus how-illus-connect">
          <span class="badge badge-jira">Jira</span>
          <span class="how-illus-line"></span>
          <span class="badge badge-ms">Microsoft 365</span>
        </div>
        <h3>Connect Jira and/or Microsoft 365</h3>
        <p>Sign in with an Atlassian API token, Microsoft 365 (OAuth), or both. Credentials stay in your macOS Keychain.</p>
      </li>
      <li class="how-card">
        <div class="how-num">2</div>
        <div class="how-illus how-illus-watch">
          <span class="check"></span><span class="check"></span><span class="check checked"></span><span class="check"></span>
        </div>
        <h3>Tell Nowtify what's urgent to you</h3>
        <p>Per-trigger watchlists. Pick which users' tickets count for SLA, which colleagues are Teams VIPs, which senders' emails matter.</p>
      </li>
      <li class="how-card">
        <div class="how-num">3</div>
        <div class="how-illus how-illus-pulse">
          <div class="mini-screen"><div class="mini-pulse"></div></div>
        </div>
        <h3>A pulse at the edge of your screen when it fires</h3>
        <p>No popups. No sounds. No dock badge. Just a thin colored glow you can look at when you want to.</p>
      </li>
    </ol>
  </div>
</section>
```

- [ ] **Step 2: Append CSS**

```css
  .section-eyebrow {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .section-title {
    font-size: clamp(28px, 3.6vw, 40px);
    line-height: 1.15;
    letter-spacing: -0.02em;
    font-weight: 600;
    margin: 0 0 56px;
    max-width: 780px;
  }
  .how { padding: var(--section-y) 0; }
  .how-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }
  .how-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 32px;
    transition: transform 200ms ease, border-color 200ms ease;
  }
  .how-card:hover { transform: translateY(-2px); border-color: var(--border-strong); }
  .how-num {
    width: 28px; height: 28px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    display: inline-flex;
    align-items: center; justify-content: center;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 24px;
  }
  .how-card h3 { font-size: 17px; margin: 18px 0 8px; font-weight: 600; letter-spacing: -0.01em; }
  .how-card p { color: var(--ink-2); font-size: 14.5px; margin: 0; }

  .how-illus {
    height: 80px;
    background: var(--accent-soft);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 0 16px;
  }
  .badge {
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    background: #fff;
    border: 1px solid var(--border);
  }
  .badge-jira { color: #0052cc; }
  .badge-ms { color: var(--accent); }
  .how-illus-line {
    width: 28px;
    height: 2px;
    background: var(--accent);
    opacity: 0.35;
    border-radius: 2px;
  }
  .how-illus-watch { gap: 10px; }
  .check {
    width: 14px; height: 14px;
    border: 2px solid var(--border-strong);
    border-radius: 4px;
    background: #fff;
  }
  .check.checked {
    background: var(--accent);
    border-color: var(--accent);
    position: relative;
  }
  .check.checked::after {
    content: '';
    position: absolute;
    left: 3px; top: 0;
    width: 4px; height: 8px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .mini-screen {
    width: 90px; height: 56px;
    background: #1c1c1e;
    border-radius: 6px;
    padding: 4px;
    position: relative;
  }
  .mini-pulse {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0);
    animation: heroPulse 4s ease-in-out infinite;
    animation-delay: 1s;
  }

  @media (max-width: 768px) {
    .how-grid { grid-template-columns: 1fr; }
  }
```

- [ ] **Step 3: Verify in browser**

Reload. Expected: a three-column grid below the hero with three white cards. Each card has a numbered indigo pill, a small CSS illustration, a title, and a one-paragraph description. The third card's mini-screen pulses in sync (slightly offset) with the hero laptop. On mobile, cards stack to one column.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add 'How it works' three-step section"
```

---

## Task 6: Features grid - Part A (six trigger cards)

**Files:**
- Modify: `docs/index.html` — replace `<!-- features goes here -->`; append CSS

- [ ] **Step 1: Replace `<!-- features goes here -->` with markup**

```html
<section class="features" id="features">
  <div class="container">
    <p class="section-eyebrow">What it watches</p>
    <h2 class="section-title">Six things Nowtify can watch.</h2>
    <p class="section-lede">Turn on what's relevant. Each trigger has its own color, its own watchlist, and its own threshold.</p>

    <ul class="feature-grid">
      <li class="feature-card" style="--card-accent: var(--red);">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 2 21h20L12 3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="18" r="0.9" fill="currentColor"/></svg>
        </span>
        <h3>Major Incident</h3>
        <p>Any open ticket flagged as a Major Incident across your Jira instance. Fires instantly, clears when the flag drops or you dismiss it.</p>
      </li>

      <li class="feature-card" style="--card-accent: var(--amber);">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="1.7"/><path d="M12 9v4l2.5 2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9 3h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </span>
        <h3>SLA breach imminent</h3>
        <p>Watched users' tickets whose SLA remaining time drops under a threshold you set (e.g. 30 minutes). Per-condition color.</p>
      </li>

      <li class="feature-card" style="--card-accent: var(--red);">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="1.7"/><path d="M12 9v4l2.5 2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m5 5 14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </span>
        <h3>SLA breached</h3>
        <p>Watched users' tickets whose SLA cycle has already expired. Stays lit until you dismiss.</p>
      </li>

      <li class="feature-card" style="--card-accent: var(--accent);">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="m8 12 3 3 5-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <h3>My pending approvals</h3>
        <p>JSM service-desk requests waiting on your approval. Counts only what's assigned to you, not the whole queue.</p>
      </li>

      <li class="feature-card" style="--card-accent: var(--teams);">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M9.5 9v6M7 12h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="19" cy="8" r="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M16.5 13.5h5v3a2.5 2.5 0 0 1-2.5 2.5h0a2.5 2.5 0 0 1-2.5-2.5v-3z" stroke="currentColor" stroke-width="1.7"/></svg>
        </span>
        <h3>Teams VIP messages</h3>
        <p>Unread Teams chat messages from people you've marked as VIPs. Threshold configurable. Clears on read.</p>
      </li>

      <li class="feature-card" style="--card-accent: var(--outlook);">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="m3 7 9 6 9-6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </span>
        <h3>Outlook email from watched senders</h3>
        <p>Unread Outlook emails from specific people. Same VIP pattern as Teams. Clears on read.</p>
      </li>
    </ul>
  </div>
</section>
```

- [ ] **Step 2: Append CSS**

```css
  .features { padding: var(--section-y) 0; background: #fff; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .section-lede {
    color: var(--ink-2);
    max-width: 640px;
    font-size: 16px;
    margin: -36px 0 56px;
  }
  .feature-grid {
    list-style: none; padding: 0; margin: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .feature-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px;
    transition: transform 200ms ease, border-color 200ms ease;
  }
  .feature-card:hover { transform: translateY(-2px); border-color: var(--border-strong); }
  .feature-icon {
    display: inline-flex;
    align-items: center; justify-content: center;
    width: 40px; height: 40px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--card-accent) 12%, white);
    color: var(--card-accent);
    margin-bottom: 18px;
  }
  .feature-icon svg { width: 22px; height: 22px; }
  .feature-card h3 { font-size: 16px; margin: 0 0 6px; font-weight: 600; letter-spacing: -0.01em; }
  .feature-card p { color: var(--ink-2); font-size: 14px; margin: 0; line-height: 1.55; }

  @media (max-width: 768px) {
    .feature-grid { grid-template-columns: 1fr; }
    .section-lede { margin-top: -28px; margin-bottom: 36px; }
  }
```

- [ ] **Step 3: Verify in browser**

Reload. Expected: white-banded section ("Features") with a 3×2 grid of six cards. Each card has a small icon in a tinted square in the card's brand color (red, amber, red, indigo, Teams purple, Outlook blue), a bold title, and a description. On mobile, cards stack to one column.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add features grid with six trigger cards"
```

---

## Task 7: Features grid - Part B (three differentiator callouts)

**Files:**
- Modify: `docs/index.html` — append markup below the existing `</ul>` in the features section; append CSS

- [ ] **Step 1: Insert markup before `</section>` (the closing tag of `.features`)**

Locate the `</ul>` followed by `</div>` followed by `</section>` in the features section. Insert this block right after `</ul>`, still inside the `</div>`:

```html
    <div class="differentiators">
      <div class="diff-card">
        <h4>Ambient, not intrusive.</h4>
        <p>A glow at the edge of your screen instead of a popup that steals focus.</p>
      </div>
      <div class="diff-card">
        <h4>You define urgent.</h4>
        <p>Per-trigger watchlists let you pick who and what matters. No app vendor deciding for you.</p>
      </div>
      <div class="diff-card">
        <h4>Local-only, no cloud.</h4>
        <p>Polls Atlassian and Microsoft directly from your laptop. No backend, no telemetry, no shared inbox.</p>
      </div>
    </div>
```

- [ ] **Step 2: Append CSS**

```css
  .differentiators {
    margin-top: 64px;
    padding-top: 56px;
    border-top: 1px dashed var(--border-strong);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 40px;
  }
  .diff-card h4 {
    font-size: 18px;
    margin: 0 0 8px;
    letter-spacing: -0.015em;
    font-weight: 600;
  }
  .diff-card p { margin: 0; color: var(--ink-2); font-size: 14.5px; }

  @media (max-width: 768px) {
    .differentiators { grid-template-columns: 1fr; gap: 28px; padding-top: 36px; margin-top: 40px; }
  }
```

- [ ] **Step 3: Verify in browser**

Reload. Expected: below the 6 feature cards, separated by a dashed top border, three side-by-side text blocks with a bold lead phrase and a short explanation each.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add Part B differentiator callouts under features grid"
```

---

## Task 8: FAQ section (with Gatekeeper-bypass walkthrough)

**Files:**
- Modify: `docs/index.html` — replace `<!-- faq goes here -->`; append CSS

- [ ] **Step 1: Replace `<!-- faq goes here -->` with markup**

```html
<section class="faq" id="faq">
  <div class="container">
    <p class="section-eyebrow">FAQ</p>
    <h2 class="section-title">Install, security, and everything else.</h2>

    <details class="faq-item" open>
      <summary>How do I install it?</summary>
      <div class="faq-body">
        <p>Nowtify is not Apple-code-signed (we're not paying $99/yr for a free tool yet), so macOS Gatekeeper will block the first launch. Here is the one-time bypass:</p>
        <ol class="install-steps">
          <li>Download the <code>.dmg</code> and double-click to mount it.</li>
          <li>Drag <strong>Nowtify</strong> into <strong>Applications</strong>.</li>
          <li><strong>Right-click</strong> Nowtify.app in Applications, choose <strong>Open</strong>, then click <strong>Open</strong> in the warning dialog.</li>
          <li>If that dialog does not give you an Open button, instead open <strong>System Settings → Privacy &amp; Security</strong>, scroll down, and click <strong>Open Anyway</strong> next to the Nowtify message.</li>
        </ol>
        <div class="install-mockup" aria-hidden="true">
          <div class="install-mockup-window">
            <div class="install-mockup-titlebar">
              <span class="dot red"></span><span class="dot amber"></span><span class="dot green"></span>
            </div>
            <div class="install-mockup-body">
              <div class="install-mockup-icon">!</div>
              <p><strong>"Nowtify" cannot be opened because Apple cannot check it for malicious software.</strong></p>
              <p class="install-mockup-sub">This software needs to be updated. Contact the developer for more information.</p>
              <div class="install-mockup-actions">
                <button class="install-btn">Move to Trash</button>
                <button class="install-btn primary">Open Anyway</button>
              </div>
            </div>
          </div>
          <p class="install-caption">↑ The dialog in System Settings → Privacy &amp; Security. Click "Open Anyway."</p>
        </div>
        <p>After the first launch, auto-update handles every future version. You only do this once.</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>What do I connect it to?</summary>
      <div class="faq-body">
        <p>Atlassian (Jira or Jira Service Management) via an API token, and/or Microsoft 365 via OAuth (Teams chat + Outlook mail). You can use just one or both.</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>Do I need admin permissions?</summary>
      <div class="faq-body">
        <p><strong>Atlassian:</strong> just your own user and an API token (create one at id.atlassian.com → Security → API tokens).</p>
        <p><strong>Microsoft 365:</strong> the first time you sign in, an admin in your tenant has to consent to the Nowtify Entra app once. This has already been done for the internal employee audience this site targets. External users would need their own admin's consent (the current Entra app is single-tenant; multi-tenant is on the roadmap).</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>Is this safe to install?</summary>
      <div class="faq-body">
        <p>Yes. Unsigned does not mean malicious - it just means we haven't paid Apple's Developer Program fee. Every line of source is public on GitHub. The app makes outbound HTTPS calls only to <code>*.atlassian.net</code> and <code>graph.microsoft.com</code> (plus GitHub for update checks). No remote command-and-control, no telemetry, no shared inbox.</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>What does it do with my data?</summary>
      <div class="faq-body">
        <p>Everything stays local. Atlassian API tokens and Microsoft refresh tokens are encrypted in your macOS Keychain via Electron's <code>safeStorage</code>. Polling happens from your laptop directly to Atlassian and Microsoft. There is no Nowtify backend, no telemetry, no analytics.</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>Why isn't it code-signed?</summary>
      <div class="faq-body">
        <p>Apple's Developer ID is $99/year. For a free internal tool, that hasn't been justified yet. If usage grows or the friction of the Gatekeeper bypass becomes a real blocker, we'll revisit.</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>Windows or Linux?</summary>
      <div class="faq-body">
        <p>macOS only. The peripheral-pulse UX is built on macOS-specific window-level APIs (transparent, click-through, always-on-top windows per display). No roadmap commitment for other platforms.</p>
      </div>
    </details>

    <details class="faq-item">
      <summary>How do I uninstall?</summary>
      <div class="faq-body">
        <p>Drag <code>Nowtify.app</code> from <code>/Applications</code> to the Trash, then optionally delete <code>~/Library/Application Support/Nowtify</code> to remove your config.</p>
      </div>
    </details>
  </div>
</section>
```

- [ ] **Step 2: Append CSS**

```css
  .faq { padding: var(--section-y) 0; }
  .faq-item {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 20px 24px;
    margin-bottom: 12px;
  }
  .faq-item > summary {
    cursor: pointer;
    font-weight: 500;
    font-size: 16px;
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .faq-item > summary::-webkit-details-marker { display: none; }
  .faq-item > summary::after {
    content: '+';
    font-size: 22px;
    line-height: 1;
    color: var(--ink-3);
    transition: transform 200ms ease;
  }
  .faq-item[open] > summary::after { transform: rotate(45deg); }
  .faq-body {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    color: var(--ink-2);
    font-size: 15px;
  }
  .faq-body p { margin: 0 0 12px; }
  .faq-body p:last-child { margin-bottom: 0; }
  .faq-body code {
    font-family: var(--font-mono);
    background: #f4f4f5;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 13px;
  }
  .install-steps { padding-left: 22px; margin: 0 0 20px; }
  .install-steps li { margin-bottom: 10px; color: var(--ink); }

  /* Gatekeeper dialog mockup */
  .install-mockup {
    background: #ecebeb;
    border-radius: 10px;
    padding: 28px;
    margin: 20px 0;
  }
  .install-mockup-window {
    background: #f5f5f5;
    border-radius: 8px;
    overflow: hidden;
    max-width: 380px;
    margin: 0 auto;
    box-shadow: 0 12px 36px -8px rgba(0,0,0,0.2);
  }
  .install-mockup-titlebar {
    height: 22px;
    background: linear-gradient(180deg, #e8e8e8, #dcdcdc);
    border-bottom: 1px solid #c8c8c8;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
  }
  .install-mockup-titlebar .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .install-mockup-titlebar .red { background: #ff5f57; }
  .install-mockup-titlebar .amber { background: #febc2e; }
  .install-mockup-titlebar .green { background: #28c840; }
  .install-mockup-body {
    padding: 22px 22px 18px;
    text-align: center;
    font-size: 13px;
    color: #1c1c1e;
  }
  .install-mockup-body p { margin: 0 0 10px; }
  .install-mockup-icon {
    width: 44px; height: 44px;
    background: var(--amber);
    color: #fff;
    border-radius: 50%;
    display: inline-flex;
    align-items: center; justify-content: center;
    font-weight: 700;
    font-size: 28px;
    margin-bottom: 14px;
  }
  .install-mockup-sub { color: var(--ink-3); font-size: 12.5px; }
  .install-mockup-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 14px;
  }
  .install-btn {
    background: #fff;
    border: 1px solid #c8c8c8;
    border-radius: 6px;
    padding: 5px 14px;
    font-size: 13px;
  }
  .install-btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    font-weight: 500;
  }
  .install-caption {
    text-align: center;
    color: var(--ink-3);
    font-size: 13px;
    margin: 14px 0 0;
  }
```

- [ ] **Step 3: Verify in browser**

Reload. Expected:
- The FAQ section appears with the first item ("How do I install it?") expanded by default.
- Inside that item: numbered install steps, a mockup of the macOS Gatekeeper dialog (gray window with a yellow `!` icon and two buttons), and a caption.
- The remaining 7 FAQ items are collapsed with a `+` icon. Clicking each one toggles open, rotating the `+` to an `×`.
- Mobile: layout stays readable; the dialog mockup shrinks to fit.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add FAQ accordion with Gatekeeper-bypass walkthrough"
```

---

## Task 9: Footer

**Files:**
- Modify: `docs/index.html` — replace `<!-- footer goes here -->`; append CSS

- [ ] **Step 1: Replace `<!-- footer goes here -->`**

```html
<footer class="site-footer">
  <div class="container site-footer-inner">
    <div class="footer-brand">
      <svg class="footer-mark" viewBox="0 0 120 120" aria-hidden="true">
        <rect x="32" y="34" width="56" height="11" rx="3" fill="#4f46e5" opacity="0.28"/>
        <rect x="26" y="52" width="68" height="14" rx="3.5" fill="#4f46e5" opacity="0.55"/>
        <rect x="20" y="72" width="80" height="20" rx="5" fill="#4f46e5"/>
      </svg>
      <span>Nowtify is free and open source.</span>
    </div>
    <nav class="footer-links">
      <a href="https://github.com/paulg7516/nowtify">GitHub</a>
      <a href="https://github.com/paulg7516/nowtify/releases">Releases</a>
      <a href="https://github.com/paulg7516/nowtify/issues">Issues</a>
    </nav>
    <p class="footer-credit">© <span id="footerYear">2026</span> · Built by Paul Gerios.</p>
  </div>
</footer>
```

- [ ] **Step 2: Append CSS**

```css
  .site-footer {
    padding: 40px 0;
    border-top: 1px solid var(--border);
    background: #fff;
  }
  .site-footer-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .footer-brand { display: inline-flex; align-items: center; gap: 10px; }
  .footer-mark { width: 22px; height: 22px; }
  .footer-links { display: flex; gap: 18px; }
  .footer-links a:hover { color: var(--ink); }
  .footer-credit { margin: 0; font-family: var(--font-mono); font-size: 12px; }

  @media (max-width: 768px) {
    .site-footer-inner { flex-direction: column; align-items: flex-start; gap: 14px; }
  }
```

- [ ] **Step 3: Append year script** (inside the existing `<script>` block)

```javascript
  document.getElementById('footerYear').textContent = String(new Date().getFullYear());
```

- [ ] **Step 4: Verify in browser**

Reload. Expected: a footer row with the mark + "Nowtify is free and open source." on the left, three links in the middle, and "© 2026 · Built by Paul Gerios." on the right. On mobile, all three sections stack vertically.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): add footer with repo links and dynamic year"
```

---

## Task 10: Smooth-scroll for nav anchor links

**Files:**
- Modify: `docs/index.html` — add one CSS line

- [ ] **Step 1: Add this to the `:root` block** (or anywhere in `<style>`)

```css
  html { scroll-behavior: smooth; scroll-padding-top: 80px; }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
  }
```

- [ ] **Step 2: Verify in browser**

Reload. Click each nav link (How it works, Features, FAQ). Expected: the page smoothly scrolls to the target section, and the section top is offset 80px below the sticky nav (so the section title is not hidden behind the nav).

- [ ] **Step 3: Commit**

```bash
git add docs/index.html
git commit -m "feat(site): smooth-scroll nav with sticky-nav offset"
```

---

## Task 11: Final visual + responsive QA

**Files:** none (review only)

- [ ] **Step 1: Desktop pass at 1280px**

Open `docs/index.html` in Chrome or Safari at a window width of approximately 1280px. Scroll the entire page top to bottom. Check:
- Nav stays sticky, blur effect visible over content below
- Hero headline does not wrap awkwardly
- Laptop pulse animation runs (visible indigo→pink glow every 4s)
- All 6 feature cards in a 3-column grid, equal heights
- All 3 differentiator cards in 1 row
- FAQ items expand/collapse smoothly
- Footer is on one row

- [ ] **Step 2: Mobile pass at 375px**

DevTools → toggle device toolbar → iPhone SE (375px width). Check:
- Hamburger toggle works and reveals the nav links
- Hero headline scales down (clamp() should produce ~40px)
- Laptop visual still fits
- "How it works" cards stack to 1 column
- Features grid stacks to 1 column
- Differentiator cards stack to 1 column
- FAQ items remain readable, Gatekeeper mockup fits without overflow
- Footer stacks to 3 lines

- [ ] **Step 3: Reduced-motion pass**

macOS: System Settings → Accessibility → Display → "Reduce motion" ON. Reload. Confirm the hero laptop border is statically lit indigo (no pulse animation). The how-it-works mini-screen also stops pulsing.

- [ ] **Step 4: No-JS pass**

Chrome DevTools → Command Menu (Cmd-Shift-P) → "Disable JavaScript" → reload. Expected:
- Page renders fully (no broken layout)
- Download button still has its fallback `href` to the releases page
- Version + size show the hardcoded `v0.5.10 · ~173 MB` (not API-patched)
- Nav scroll-border effect is missing (it required JS) but otherwise nav works
- FAQ accordion works (native `<details>`)

Re-enable JS before continuing.

- [ ] **Step 5: Link audit**

Click every link on the page. Expected: no 404s. The Download button should land on the actual `.dmg` (or releases page if JS disabled). GitHub repo link → github.com/paulg7516/nowtify. Releases link → github.com/paulg7516/nowtify/releases.

- [ ] **Step 6: If any QA step fails, fix in place and re-verify before continuing**

No commit for this task (review-only). Fixes from QA get their own commits.

---

## Task 12: Enable GitHub Pages

**Files:** none (GitHub UI action)

This is a one-time setup the human (Paul) needs to do via the GitHub web UI - it is not scriptable through the standard `gh` CLI in a way that's safer than just clicking.

- [ ] **Step 1: Push the site commits to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Enable Pages in repo settings**

In the browser, go to:
```
https://github.com/paulg7516/nowtify/settings/pages
```

Configure:
- **Source:** Deploy from a branch
- **Branch:** `main` / Folder: `/docs`
- Click **Save**

GitHub will report the published URL (typically `https://paulg7516.github.io/nowtify/`) within ~30-60 seconds.

- [ ] **Step 3: Verify the deployed site**

Open `https://paulg7516.github.io/nowtify/` in a browser. Confirm everything from Task 11 still works on the deployed version. Specifically: the GitHub API call to fetch the latest release should still succeed from the Pages domain (no CORS issues - `api.github.com` allows browser fetches).

If the site shows a 404, wait another minute and refresh; first-deploy propagation can lag.

- [ ] **Step 4: Commit nothing (this task is repo-level config)**

Optionally update the README with a "**Website:** https://paulg7516.github.io/nowtify/" line and commit that:

```bash
# only if you want to advertise the URL in README
git add README.md
git commit -m "docs: link to the project website in README"
git push origin main
```

---

## Task 13: Smoke test for the download patcher logic

**Files:**
- Create: `tests/website-download-patcher.test.js`
- Modify: `docs/index.html` — refactor the patcher to export a testable function (optional, see Step 1 note)

Note: this is a one-off automated test. The site itself is mostly visual-verification territory, but the GitHub-API parsing logic is the one piece with branchy control flow worth pinning down (asset filter, fallback paths, size formatting). Without this test, a future tweak to the patcher could silently break the download button.

- [ ] **Step 1: Extract the patcher into a testable form inside `docs/index.html`**

Replace the existing patcher IIFE (from Task 4) with a function-and-invoke pair so the function is exposed via a UMD-style export-when-Node-or-window stub:

```javascript
  function nowtifyParseRelease(data) {
    if (!data || !Array.isArray(data.assets)) return null;
    const dmg = data.assets.find(a => a && typeof a.name === 'string' && a.name.endsWith('.dmg'));
    if (!dmg) return null;
    return {
      href: dmg.browser_download_url,
      version: data.tag_name || data.name || null,
      sizeMb: Math.round(dmg.size / (1024 * 1024)),
    };
  }
  // Expose for Node test runner; ignored in browser.
  if (typeof module !== 'undefined') { module.exports = { nowtifyParseRelease }; }

  (async function patchDownload() {
    if (typeof window === 'undefined') return; // skip in Node
    const btn = document.getElementById('downloadBtn');
    const vEl = document.getElementById('downloadVersion');
    const sEl = document.getElementById('downloadSize');
    try {
      const res = await fetch('https://api.github.com/repos/paulg7516/nowtify/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) return;
      const parsed = nowtifyParseRelease(await res.json());
      if (!parsed) return;
      btn.setAttribute('href', parsed.href);
      if (parsed.version) vEl.textContent = parsed.version;
      sEl.textContent = `~${parsed.sizeMb} MB`;
    } catch (_) { /* fallback to HTML defaults */ }
  })();
```

- [ ] **Step 2: Write the failing test at `tests/website-download-patcher.test.js`**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Extract the inline <script> block from docs/index.html and load
// nowtifyParseRelease into a sandbox. We deliberately do not import a real
// browser DOM - we only want the pure parsing function.
function loadParser() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No <script> block found in docs/index.html');
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return sandbox.module.exports.nowtifyParseRelease;
}

const parse = loadParser();

test('returns null when data is falsy', () => {
  assert.equal(parse(null), null);
  assert.equal(parse(undefined), null);
});

test('returns null when assets is missing or not an array', () => {
  assert.equal(parse({}), null);
  assert.equal(parse({ assets: 'nope' }), null);
});

test('returns null when no .dmg asset is present', () => {
  const data = { tag_name: 'v0.5.10', assets: [{ name: 'foo.zip', browser_download_url: 'x', size: 1 }] };
  assert.equal(parse(data), null);
});

test('extracts href, version, and rounded MB size from a real-shaped payload', () => {
  const data = {
    tag_name: 'v0.5.10',
    assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://x/yml', size: 521 },
      { name: 'Nowtify-0.5.10-universal.dmg', browser_download_url: 'https://x/dmg', size: 181273673 },
      { name: 'Nowtify-0.5.10-universal-mac.zip', browser_download_url: 'https://x/zip', size: 174859498 },
    ],
  };
  assert.deepEqual(parse(data), {
    href: 'https://x/dmg',
    version: 'v0.5.10',
    sizeMb: 173,
  });
});

test('falls back to data.name when tag_name is missing', () => {
  const data = {
    name: 'Release 0.6.0',
    assets: [{ name: 'Nowtify.dmg', browser_download_url: 'https://x/dmg', size: 1048576 }],
  };
  assert.equal(parse(data).version, 'Release 0.6.0');
});
```

- [ ] **Step 3: Run the test to verify it fails first** (only if you skipped Step 1)

```bash
node --test tests/website-download-patcher.test.js
```

If you already did Step 1 the tests will pass on first run. If you skipped it, you'll see the parser returning `undefined` for everything - revert and do Step 1.

- [ ] **Step 4: Run the test, confirm it passes**

```bash
node --test tests/website-download-patcher.test.js
```

Expected: 5 passing tests.

- [ ] **Step 5: Run the full project test suite to confirm nothing else broke**

```bash
npm test
```

Expected: existing tests still pass, plus the new file is picked up if `npm test` globs `tests/**`.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html tests/website-download-patcher.test.js
git commit -m "test(site): smoke test for GitHub releases parser logic"
```

---

## Final Step: Push everything

After all tasks pass:

```bash
git push origin main
```

Then complete Task 12 if you skipped it earlier (enable Pages in repo settings).

---

## Self-Review Notes

Coverage check vs spec:
- ✅ Sticky nav (Task 2)
- ✅ Hero with eyebrow, H1, subhead, CTA, version meta, faux laptop pulse (Tasks 3, 4)
- ✅ "How it works" three-step section (Task 5)
- ✅ Features grid Part A (six trigger cards with brand-colored icons) (Task 6)
- ✅ Features grid Part B (three differentiator callouts) (Task 7)
- ✅ FAQ with Gatekeeper-bypass dialog mockup as first/open item (Task 8)
- ✅ Footer (Task 9)
- ✅ Visual system (CSS tokens in Task 1; system fonts; clamp() typography; accent gradient reserved for hero pulse only)
- ✅ Responsive at 768px breakpoint (handled per-section)
- ✅ Reduced-motion handling (Tasks 3, 5)
- ✅ Download link patcher with API + graceful fallback (Task 4, with refactor + test in 13)
- ✅ GitHub Pages deploy from `/docs` folder (Task 12)
- ✅ M365 multi-tenant gap handled per spec (FAQ entry mentions it in passing, no badges)

No placeholders, no "TBD", no "similar to Task N". All file paths absolute or repo-relative. All code blocks self-contained.
