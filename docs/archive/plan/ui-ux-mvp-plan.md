# UI/UX MVP Plan — Reputation Key

> The target end-state for the manager/admin experience, sequenced into reviewable phases. Forthcoming from a design grilling session (2026-06-16). See [ADR 0016](../adr/0016-active-property-url-query-param.md) for the active-property navigation decision.

## Scope

- **In scope:** PropertyManager + AccountAdmin surfaces (dashboard, settings, inbox, navigation, layout). AccountAdmin is a superset (manager surfaces + org-level settings).
- **Shell-applied, content deferred:** Staff pages get the new layout shell (width tiers, breadcrumbs, states) for consistency, but no content redesign this MVP.
- **Out of MVP (future):** Staff dashboard content redesign, dedicated mobile UX, global search, report export.

## Locked decisions

| #                     | Decision                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard scope       | 1 property → deep-dive; 2+ → **fleet overview** with drill-down                                                                                          |
| Deep-dive orientation | **Balanced operational**: attention-band → KPIs → trends → goals/leaderboard summaries → recent reviews                                                  |
| Active property       | **`?propertyId=` URL context param** on cross-property pages; switcher remembers it (ADR 0016)                                                           |
| Layout system         | **3 width tiers** (`dashboard` / `standard` / `narrow`) + canonical page header (breadcrumbs + primary action)                                           |
| Settings IA           | **Personal** (Profile / Security / Preferences) + **Organization** (Organization / **Notifications** / **Recognition** / **Integrations**); built phased |
| Attention band        | **Multi-signal** (unanswered>SLA, new feedback, goals behind pace, rating drop, escalated) + **org-level response-SLA setting**                          |
| Fleet overview        | Property rows, **attention-sorted**, per-property signals, slim org-total strip                                                                          |
| Roles in scope        | PropertyManager + AccountAdmin (Staff shell-only)                                                                                                        |
| Back-navigation       | **Breadcrumbs + Cancel (forms) + contextual Back (deep-links)**                                                                                          |
| Responsive            | **Desktop-first, responsive-capable** (tablet graceful via shadcn; no dedicated mobile UX)                                                               |
| State consistency     | Standardize empty / loading / error states across all pages                                                                                              |
| Landing routes        | Manager → fleet (2+) or deep-dive (1); Staff → `home` (unchanged)                                                                                        |

---

## Phase 1 — Foundation: shell, navigation, layout system

The bedrock every subsequent phase builds on. No user-facing feature changes — this is the chrome.

- **3-tier `PageShell`** (`dashboard` / `standard` / `narrow`) replacing the single `max-w-5xl` shell.
- **Canonical page header**: breadcrumb + active-property context + primary-action slot.
- **Active-property model** (ADR 0016): extend `usePropertyId` to read `?propertyId=`; switcher sets it; cross-property pages carry + preserve it via `validateSearch`. → fixes the "I lose my property" pain.
- **Back-navigation**: breadcrumbs everywhere; `Cancel` on all create/edit forms; contextual `Back` on deep-link destinations.
- **Standardize empty / loading / error states** (skeleton, empty-state, error-retry components).
- **Landing-route clarity**: manager → fleet (2+) or deep-dive (1); staff → `home`.
- Apply the shell to **Staff pages** for consistency (no content change).

**Acceptance:** every existing page runs on the new shell with consistent width + breadcrumb + states; navigating property → inbox → back preserves the active property.

---

## Phase 2 — Dashboard: fleet overview + property deep-dive

The manager's daily surface (the centerpiece).

- **Fleet overview** (renders only for 2+ properties): property rows attention-sorted, per-property KPIs + attention count, slim org-total strip, click → that property's deep-dive.
- **Property deep-dive redesign** (balanced-operational orientation):
  1. **Attention band** — 5 signal chips, each → a pre-filtered view.
  2. **KPI strip** — scans, avg rating, reviews, feedback, review-link clicks (current/prior/trend).
  3. **Trends** — rating trend + review volume.
  4. **Goals + leaderboard summaries** — compact, deep-linking to their pages.
  5. **Recent reviews.**
- **Attention-band signals + thresholds**: unanswered review (no reply, age > Response SLA); new unactioned feedback; goal behind pace (progress < pro-rated for the active period); rating drop (avg ≥ 0.3 vs prior period); escalated inbox items.
- **Response SLA**: org setting (default 48h) + a control in Organization settings → feeds the band's "unanswered" signal. (See `CONTEXT.md` → Response SLA.)
- **Time-range default `30d`** (operational), not `all`.

**Cross-phase dependency:** the attention band needs the Response-SLA setting. Phase 2 ships the SLA backend + a minimal control; Phase 3 polishes the full Organization settings IA around it. Phase 2 may use a fixed 48h default until the Phase 3 UI lands.

**Acceptance:** manager opens the app → sees the fleet (or deep-dive if 1 property) → the attention band shows what needs action → click a chip → land on the filtered triage list.

---

## Phase 3 — Settings: refresh + new surfaces

- **Pass A — refresh** Profile / Security / Organization / Preferences onto the new shell + `narrow` tier.
- **Pass B — add the missing surfaces:**
  - **Notifications** — per-notification-type (badge awarded, new review, new feedback, escalated, digest) × channel toggles (in-app / email) + digest-frequency selector.
  - **Recognition** — org-level enable/disable per badge definition.
  - **Integrations** — Google Business Profile connection management.
- **IA**: grouped under **Personal** vs **Organization**.

**Acceptance:** every backend setting has a UI; no orphaned configuration.

---

## Phase 4 — Consistency & polish

- Sweep remaining pages (leaderboard, team, progress, property sub-pages) onto the shell + width tiers.
- Tablet/responsive verification (desktop-first, degrade gracefully).
- Empty/error state sweep across all pages.

**Acceptance:** no width/button/layout drift anywhere; Staff pages consistent with the new shell.

---

## Open micro-decisions (resolve during implementation)

- KPI strip: confirm the 5 KPIs are the right set (scans, avg rating, reviews, feedback, review-link clicks) — backend already delivers them.
- Goals/leaderboard summary: exact compact shape (sparkline vs. progress bar vs. number).
- Digest-frequency options for Notifications settings.
