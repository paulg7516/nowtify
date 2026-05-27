# Changelog

Notable changes per release. Newest at top. Patch versions roll up small fixes
and visual tweaks; minor versions ship meaningful features; the major version
stays at 0 while the app stabilizes.

---

## v0.4.7 — Robustness foundation

Senior-engineering pass. Introduces tooling + tests that would have caught
multiple regressions we shipped during v0.4.x.

**Tooling**
- ESLint with rules tuned for the bug classes we've actually hit
  (`no-undef`, `no-unused-vars`, `no-redeclare`)
- `node --test` suite for pure helper logic
- Pre-ship gate in `scripts/ship.sh`: aborts the ship if lint or tests fail
- `npm run lint` and `npm test` scripts

**Tests** (under `test/`)
- Trigger scope migration logic (idempotency, data preservation, per-type behavior)
- Scope summary formatting (the "3 people, 1 group" strings shown in the UI)

**Engine robustness fixes** (from internal code review)
- Per-step error accumulation: SLA / Teams trigger A's error is no longer
  silently erased by trigger B's success
- Re-entrancy guard on `engine.tick()`: a `pokeNow()` triggered during a
  long-running tick is now skipped instead of racing on `previousActiveKeys`
- In-flight de-dup on MS Graph token refresh: concurrent refresh attempts
  share a single POST to `/token`, preventing the rotation race that
  invalidates the session

**Settings hardening**
- `settings:save` IPC now validates per-key value shapes; a renderer can
  no longer write `triggers: "garbage"` and crash the engine forever

---

## v0.4.6 — Engine health monitoring

Surfaced engine state so silent failures stop being silent.

- `EngineHealth` tracked in the main process: last tick timestamp, per-step
  errors, per-type counts (mi/sla/approval/teams), overall healthy flag
- New "Engine health" card in Settings → Updates: status dot + last tick +
  counts + per-step error list
- Small `⚠` indicator next to the version stamp in the popover header when
  the last tick had errors

## v0.4.5 — Critical fix: dangling `watchList` reference

Single-character refactor miss that crashed the entire engine on every tick.
Surfaces as "all tabs show 0 forever after install." Root cause: removed the
declaration but left an inline reference inside `nameFor()`. Caught (after
the fact) by terminal-run diagnostic; would have been caught pre-ship by
ESLint `no-undef` (which v0.4.7 now enforces).

## v0.4.4 — Integrations panel + real brand logos

- Collapsed Jira and Teams into a single "Integrations" nav item
- Real Atlassian Jira logo (Iconify `logos:jira`) inlined
- Real Microsoft Teams logo (Iconify `logos:microsoft-teams`) inlined
- Same SVG used in the popover Teams meeting button, kept in sync

## v0.4.3 — Embedded trigger scope (IA restructure)

- Removed the standalone "Watch list" nav section and "Watched users"
  subsection inside the Teams panel
- Each SLA trigger now owns its `scope: {users, groups}`
- Each Teams trigger owns its `scope: {users}`
- Major Incident and Approval triggers have implicit scope ("Instance-wide"
  and "Just me" respectively)
- One-shot migration on startup copies the old global `watchList`,
  `watchGroups`, and `teams.watchedUsers` into the appropriate triggers
- New inline picker expands under a trigger card when clicked

## v0.4.2 — Brand polish (Option A)

- Page background tinted toward indigo
- 2px indigo→pink gradient hairline under the top header
- Sidebar tinted background
- Active nav item: indigo gradient + white text
- Primary CTAs and toggle-ON states get subtle gradient
- Card and row hover states tinted indigo

## v0.4.1 — Branding preview (Option B, reverted)

Bolder treatment: 6px gradient strip at top, sidebar gradient edge, brand
halo. Rejected as "too much" for the IT-ops audience and reverted in v0.4.2.

## v0.4.0 — Nav restructure: Jira / Teams / Triggers / Updates

- Renamed "Connection" to "Jira" (preparation for multi-integration model)
- Visual dividers between nav groups
- "Watch list" nav item removed (data still present, used by SLA triggers)

## v0.3.x — Teams integration

- v0.3.0: Teams alerts wired through to engine + popover Messages tab
- v0.3.4: HTML stripped from message previews; meeting chats filtered out
  to prevent ghost alerts from auto-created Teams meeting sidebars
- v0.3.2: Fixed `getTeams()` not returning `watchedUsers` (caused engine
  to read 0 watched users despite store having entries)
- v0.3.3: Removed `$orderby` from `/me/chats` Graph query (unsupported,
  returned 400 - now hand-sorts client-side)
- v0.3.6: CSS specificity fix - `[hidden]` attribute now wins over
  `.btn { display: inline-flex }` so hidden buttons actually hide

## v0.2.x — Teams OAuth + watched users picker

- v0.2.0: PKCE OAuth flow with Microsoft, encrypted token storage,
  Connect / Disconnect UI
- v0.2.1: Added `CFBundleURLTypes` to Info.plist so macOS Launch Services
  registers `nowtify://` at install time (runtime registration was
  insufficient for unsigned apps)
- v0.2.2: Watched users picker (Graph `/users?$search`)
- v0.2.3: Disconnect preserves watched users list across re-auth cycles
  (was wiping them, frustrating users who had to rebuild the list)

## v0.1.x — Core JSM integration

- Ambient screen-border pulse Electron app
- JSM polling for Major Incident + SLA + Approval triggers
- Encrypted API token storage via Electron `safeStorage`
- Custom unsigned-update install helper (Squirrel.Mac requires code
  signing which the app doesn't have yet)
