# UI/UX overhaul proposal — dashboard, reviews AI panel, settings

> **Superseded proposal.** This remains useful as a dated UI inventory, but its
> recommendations are not current product authority. Implement against the
> [2026-08-25 comprehensive beta program](../comprehensive-beta-implementation-program-2026-08-25.md)
> and the nearest context contract.

Date: 2026-08-19. Companion to the two current-state audits in this folder, which supply
every fact cited here:

- `current-state-dashboard-and-reviews-2026-08-19.md`
- `current-state-settings-2026-08-19.md`

This document proposes. Those two document reality. Where I recommend something, the
evidence is a `file:line` or a schema table from those audits.

---

## 0. The one-line diagnosis

**The product computes far more than it shows.** This is not a styling problem. Three
examples, all verified:

| Built                                                                                                                                         | Surfaced                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ai_property_daily_aggregates` — 20 count columns per property per day: 4 sentiment, 10 category, 4 attention, plus `reviewCount`/`ratingSum` | **Nothing.** Only consumer is the adapter that writes it                                     |
| `rollup_daily_metrics`, `rollup_weekly_metrics`, `rollup_daily_inbox_metrics` — including `avgResponseHours`                                  | **Nothing.** Written by `incremental-rollup.ts`, read by no reader anywhere in `src`         |
| `replies` — a 15-column AI provenance block                                                                                                   | **Nothing.** Both read-only views narrow the reply to `{text, publishedAt, rejectionReason}` |

`DashboardData.ratingTrend` and `.reviewVolume` are computed on the server, serialized to
the browser, and never rendered — they appear only in Storybook fixtures. The work is done.
The wiring is missing.

So the overhaul is mostly **surfacing and organising**, not building new pipelines. That
makes it unusually cheap for its impact, and it changes the sequencing: do not start with
visual redesign, start with connecting what exists.

---

## 1. Dashboard

### 1.1 What is wrong structurally

There is no single dashboard. `/dashboard` renders a fleet view **only for multi-property
orgs**; a single-property org is redirected to `/properties/$propertyId` by a `useEffect`
(`dashboard.tsx:60-70`). So the majority of closed-beta tenants — single-property hotels —
never see `/dashboard` at all, and the page the team thinks of as "the dashboard" is not
the page they land on.

`/properties/$propertyId/metrics` is a hardcoded `EmptyState` reading "Metrics coming soon"
(`metrics.tsx:35`) with no loader and no query, while the metric plane behind it has six
populated tables.

Three further structural defects:

| Defect                                                                       | Evidence                                                              | Consequence                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Fleet time range hardcoded to `30d`                                          | `dashboard.tsx:26`                                                    | No period comparison is possible; every number is a 30-day number with no way to ask "versus last month" |
| `nextCursor` computed and delivered, no pagination control exists            | `types.ts:186`; `FleetOverview` destructures `{entries, totals}` only | A fleet beyond one page silently truncates                                                               |
| `attentionSignals` 5-way breakdown delivered, only `totalAttention` rendered | `types.ts:171`; `FleetRow` reads the total                            | "12 needing action" with no indication whether that is 12 urgent or 12 low                               |

### 1.2 Proposed information architecture

Collapse to **one dashboard route** that adapts, rather than two that diverge:

```
/dashboard
  ├─ scope switcher: All properties ▾ | Hotel Elegance | Urban Move
  ├─ period control:  7d | 30d | 90d | custom   (+ compare-to-previous toggle)
  └─ sections (identical shape at fleet and property scope)
```

A single-property org lands on `/dashboard` with the scope pre-set, instead of being
redirected away. Property deep-dive keeps its own route for linkability, but the dashboard
is no longer a different page depending on tenant shape.

### 1.3 Proposed sections, each backed by data that already exists

Ordered by decision value, not by what is easiest to draw.

**A. Needs action — first, above the fold.**
Replace the single `totalAttention` count with the 5-way `attentionSignals` breakdown that
is already computed. Urgent gets its own colour and its own click-through into the inbox
pre-filtered — the inbox already has an attention filter (`inbox-list-header.tsx:68-92`),
so this is a link, not a feature.

**B. Reputation over time — the headline chart.**
`ratingTrend` and `reviewVolume` already arrive in the browser. Render them. Use the
existing `chart.tsx` primitive (currently unused on the property dashboard — the rating
distribution is hand-rolled `div`s). One dual-axis chart: average rating as a line, review
volume as bars, with the period-compare overlay when the toggle is on.

**C. What guests talk about — category breakdown.**
Straight from `ai_property_daily_aggregates`' 10 category counts. A horizontal bar list
sorted by volume, each row click-through to the inbox filtered by that category. This is
the single highest-value unlock in the whole proposal: it is the answer to "what should I
fix?", it is already computed daily, and it currently has zero UI.

**D. Sentiment mix.**
The 4 sentiment counts as a stacked bar over the period, not a single number. Sentiment
without a trend is not actionable.

**E. Response performance.**
`rollup_daily_inbox_metrics` already maintains `openCount`, `closedCount`, `escalatedCount`
and `avgResponseHours`. Surface median and p90 response time against the org's
`responseSlaHours` setting — which is settable today (`/settings/organization`) and measured
against nothing. A setting with no corresponding measurement is a broken loop.

**F. AI activity and budget.**
Currently invisible: a tenant cannot see quota consumption, cost, or why an operation
failed. `ai_property_quota_windows` enforces a 500-analysis and 100-reply daily cap via
CHECK constraints, and the user has no way to know they are near either. Show
consumed/remaining against cap, and a compact operations feed with `failureCode` where
present.

**G. Trend narrative.**
`ai_property_trend_outcomes` is indexed `recordedAt desc` but only the current row is ever
read. Expose the history as a short timeline so a trend that reversed is visible as a
reversal rather than silently replaced.

### 1.4 What to delete

- The `/properties/$propertyId/metrics` placeholder route. Either wire it to the metric
  plane or remove the nav entry; a permanent "coming soon" costs trust on every visit.
- `InboxFilters` (`inbox-filters.tsx`). It declares an `attention` filter, renders no
  control for it, and is never mounted — only its own story and two type-only imports
  reference it. Dead surface that will drift.

---

## 2. Reviews page, third panel: the AI reply controls

### 2.1 Start by keeping what is already right

The existing implementation gets the hard part correct, and a redesign must not regress it.
Specifically:

| Existing behaviour                                                                                                                         | Why it is correct                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Suggestion rendered in a separate bordered section, never injected into the draft                                                          | Preserves authorship; the user's text stays theirs                                     |
| Explicit "Use suggestion" with a confirm dialog showing current draft vs suggestion side by side (`reply-suggestion-controls.tsx:141-153`) | This is the Verification pattern — a deliberate pause between proposal and consequence |
| "Review required. Nothing is saved or submitted automatically." (`:94`)                                                                    | States the governance contract in the interface, where it is actually read             |
| Suggestion self-clears at `expiresAtEpochMillis`, on `pagehide`, and when the draft diverges                                               | Prevents adopting a stale suggestion against changed source                            |
| Specific error vocabulary for `language_not_supported`, `not_authorized`, `source_changed`                                                 | Distinguishes "cannot" from "failed", which is most of perceived reliability           |

**Explicit recommendation: do not turn this into a chat.** The reply flow is a single-shot
constrained selection — the model picks one of four template IDs and echoes a language tag;
the prose comes from a versioned template catalogue, not from the model. A
`Conversation`/`Message` transcript UI would misrepresent the system as free-form
generation, invite users to expect instruction-following the governance plane deliberately
forbids, and add turn state with nothing to put in it. AI Elements is the right library to
borrow from; its chat family is the wrong part to borrow.

### 2.2 The real defects to fix

**Defect 1 — AI controls exist in only one of seven reply states.**
`resolveReplyView` maps a reply to eight views, and `ReplySuggestionControls` mounts only
under `kind: 'compose'`. So `pending_approval`, `approved`, `published`, `publish_failed`,
`rejected` and `mirror` show no AI affordance at all. Two of those are exactly where a user
needs one: `rejected` (rework the draft) and `publish_failed` (retry). The `rejected` view
already renders an "Edit & Resubmit" button whose handler is `() => {}`
(`reply-status-view.tsx:114`).

**Defect 2 — provenance is invisible, so a published AI reply is indistinguishable from a
human one.** Fifteen columns of provenance are persisted and none reaches the UI. For a
product whose entire architecture is built on attestable AI governance, the interface
discloses nothing. This is both a trust feature and, plausibly, a disclosure obligation.

**Defect 3 — the AI signals panel shows 4 of the available fields.** It renders
`sentiment`, `primaryCategory`, `attention` and a timestamp, and collapses every
`unavailableReason` into one sentence (`inbox-review-analysis.tsx:39`). `urgencySignals`
(safety, health, discrimination, legal, fraud, service_failure) is never shown — the most
decision-relevant field in the analysis.

**Defect 4 — no feedback channel.** Nothing records whether a suggestion was good. The
adoption disposition column exists (`ai_operations.replyAdoptionDisposition`); the UI never
asks.

### 2.3 Proposed panel 3 structure

```
┌─ Review ─────────────────────────────────────────┐
│ ★★★☆☆  Ivan P.  ·  12 Aug  ·  bg-Cyrl            │
│ "Нов Семеен хотел. Странна архитектура…"          │
│ ▸ Translated by Google                            │
├─ AI signals ─────────────────────────────────────┤
│ ⚠ Urgent   mixed   Accessibility                  │
│ Flags: accessibility · service_failure            │  ← urgencySignals, new
│ Analysed 12 Aug 14:20 · analysis-v1              │
├─ Reply ──────────────────────────────────────────┤
│ [ tone ▾ ]  [ ✨ Suggest reply ]                  │
│ ┌ AI suggestion ─────────────────────── [badge] ┐ │
│ │ Thank you for your feedback…                  │ │
│ │ ▸ Why this suggestion                         │ │  ← new, collapsed
│ │   template: acknowledge_concern               │ │
│ │   language: bg-Cyrl · catalogue v1            │ │
│ │   model: gpt-5.6-luna · 1.2s · 80 tokens      │ │
│ │ Review required. Nothing is saved automatically│ │
│ │ [ Use suggestion ]  [ Discard ]  [ 👍 👎 ]     │ │  ← feedback, new
│ └───────────────────────────────────────────────┘ │
│ [ your draft textarea ]                           │
└──────────────────────────────────────────────────┘
```

Concrete changes:

1. **Mount AI controls in `rejected` and `publish_failed`**, and implement the dead
   "Edit & Resubmit" handler. A rejected draft is precisely when regeneration is wanted.
2. **Add a collapsed "Why this suggestion" disclosure** carrying template id, concrete
   language, catalogue version, model snapshot, latency and token count. Collapsed by
   default so it costs nothing until asked for; this is the AI Elements `Reasoning`
   disclosure pattern applied to attestation rather than chain-of-thought — which is the
   honest use here, since this model returns no reasoning text to show.
3. **Render `urgencySignals` as discrete flags**, not folded into the attention word.
4. **Add an AI-assisted marker to published replies**, sourced from `replies.authorship`,
   with the provenance disclosure available behind it.
5. **Add thumbs up/down** writing to the existing adoption-disposition column.
6. **Replace the generic fallback message** where a specific one exists. "A suggestion is
   unavailable right now" is correct as a last resort, but truncation, quota exhaustion and
   provider refusal are distinguishable in the settlement row and should be distinguishable
   in the copy.

### 2.4 Which shadcn / AI Elements pieces to adopt

29 shadcn primitives already exist in `src/components/ui/**`. Prefer them. From AI Elements,
adopt selectively:

| Adopt                                  | Use here                                              | Skip                                                    |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `Response` / streamable text container | Suggestion body                                       | `Conversation`, `Message` — no transcript exists        |
| `Reasoning` disclosure shape           | The "Why this suggestion" attestation panel           | Its streaming-token behaviour — nothing streams         |
| `Actions` row                          | Use / Discard / feedback, consistently placed         | `PromptInput` — there is no free-form prompt, by design |
| `Loader`                               | Replace the text-only `'Suggesting…'` label           | `Tool`, `Artifact`, `Sandbox` — no tool calls           |
| `Suggestion` chips                     | Tone presets, if tone becomes more than three options | —                                                       |

Install via the registry into `src/components/ai-elements/`, then restyle to the existing
token set. Do not import the Vercel AI SDK: this app has its own governed egress plane and
the SDK's streaming/transport layer is not wanted.

---

## 3. Settings

### 3.1 Why it feels chaotic — measured

Ten routes, four scopes, one flat ungrouped list (`settings-sidebar.tsx:41-107`):

| Scope        | Routes                                                   |
| ------------ | -------------------------------------------------------- |
| User account | `/profile`, `/security`, `/preferences`(device)          |
| Organization | `/organization`, `/members`, `/integrations`             |
| Property     | `/recognition`, `/ai`                                    |
| Mixed        | `/notifications` — writes user×org×property AND user×org |

Nothing in the interface tells the user which scope they are editing. That is the whole
complaint, and it is a real structural fact rather than a matter of taste.

Five collisions, each verified:

1. `/settings/preferences` advertises notification preferences as "Coming soon"
   (`preferences-settings-page.tsx:35`) while `/settings/notifications` already ships them —
   both live in the sidebar simultaneously.
2. `responseSlaHours` is writable through two independently validated server functions
   (`organizations.response-sla.ts:54`, `organizations.update.ts:42`).
3. `/settings/notifications` is described as "property-specific" (`notifications.tsx:67`)
   but writes org-scoped locale/timezone; the governance catalogue records its scope as
   `organization`.
4. Portal theme and publication state are called "Settings" and live outside `/settings`
   entirely.
5. Property selection is modelled three different ways across three property-scoped
   screens — URL param with selector, URL param with **no** selector (so the sidebar link
   is a dead end), and local `useState` (not linkable, resets on reload).

### 3.2 Proposed IA — group by scope, label the scope

```
Settings
  ACCOUNT            (you, everywhere)
    Profile
    Security
    Appearance                      ← was Preferences; drop the dead notifications card
  ORGANIZATION       (Hotel Group Ltd)
    General                         ← identity, billing, response SLA
    Members & roles
    Integrations
    Notifications                   ← org-scoped half only: locale, timezone, digests
  PROPERTY           [ Hotel Elegance ▾ ]      ← ONE persistent selector for the section
    AI & consent
    Recognition
    Notification delivery           ← property-scoped half: per-category channels
```

Four decisions embedded there:

1. **Split notifications along its real seam.** Locale/timezone are org-scoped; per-category
   channel toggles are property-scoped. One page writing two scopes with one misleading
   header is the root of the confusion.
2. **One property selector for the whole PROPERTY group**, in the URL, persisted across
   the section. Kills the three-mechanism divergence and the dead-end Recognition link.
3. **Scope named in the section header on every page**, e.g. "Organization · General" and
   "Hotel Elegance · AI & consent".
4. **Delete both "Coming soon" placeholder cards** (`preferences`, and the 2FA card at
   `security-settings-form.tsx:117`). Ship or remove.

Also worth resolving: 24 of 37 settings-adjacent tables have no UI at all. Most should stay
that way (migration-owned AI catalogues, quarantine tables). But
`organization_role_policy` has three working CRUD server functions with **zero callers**
anywhere — custom roles are implemented on the server and unreachable from the interface.
That is either a feature to expose or dead code to delete; it should not stay in limbo.

### 3.3 Notification settings — the reported breakage

The audit found 16 defects. These are the ones that make it look broken:

| #   | Defect                                                                                                                                                                                                                                               | Fix                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| S1  | Four `useState` seeds never re-sync from refetched props, and `localPreferences` is the only render source — so server state never reaches the screen after a mutation                                                                               | Derive from the query; drop the local mirror                                                                      |
| S6  | **The entire Email column is inoperative for any non-allowlisted beta tenant** — `notification.send_email` is non-core, so every email switch, cadence select and quiet-hours save fails, and the UI renders them fully enabled with a generic toast | Gate the column on the capability: disable with an explanatory note, or hide it                                   |
| L1  | `<legend>` inside a `display:grid` fieldset is not a grid item, so the explicit `col-start`/`row-start` placements compute against a grid it never joins — the category title floats away from its controls                                          | Replace `<legend>` with a `<div role="heading">`, or take the fieldset out of grid                                |
| L2  | No `min-w-0` anywhere inside a `max-w-3xl` shell; the grid fieldset inherits `min-inline-size: min-content` and cannot shrink                                                                                                                        | Add `min-w-0` on the view root, cards and fieldsets — the sibling AI settings page already does this deliberately |
| L3  | Raw unstyled `<select>`/`<button>` with no focus ring or disabled styling, while the repo ships shadcn `Select` and `Button`                                                                                                                         | Use the primitives                                                                                                |
| F1  | Locale and timezone are bare inputs with no enclosing `<form>`; Enter does nothing                                                                                                                                                                   | Wrap in a form with a real submit                                                                                 |
| F7  | Auto-save on switches mixed with explicit Save buttons on the same screen                                                                                                                                                                            | Pick one; explicit, to match every other settings page                                                            |

Zero Storybook stories exist for any notification-settings component — the three
`notification-*.stories.tsx` files cover the bell popover only. Given the sibling AI
settings page has six stories including a deliberate long-name narrow-screen fixture, this
is the clearest available explanation for why one page looks broken and the other does not.
**Add stories first**, covering the capability-denied state, the mandatory-locked row, the
zero-property empty state and a narrow viewport; then fix against them.

---

## 4. Sequencing

Ordered by value per unit of risk. Each step is independently shippable.

| #   | Work                                                                             | Risk   | Why first                                                                     |
| --- | -------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| 1   | Notification settings: stories, then S1/S6/L1/L2/L3/F1                           | Low    | It is visibly broken today and self-contained                                 |
| 2   | Render `ratingTrend` + `reviewVolume` with the existing `chart.tsx`              | Low    | Data already in the browser; pure wiring                                      |
| 3   | Category breakdown + sentiment mix from `ai_property_daily_aggregates`           | Low    | Highest-value unlock; needs a read port, no new pipeline                      |
| 4   | Attention 5-way breakdown + inbox click-through                                  | Low    | Data already delivered                                                        |
| 5   | Panel 3: `urgencySignals`, provenance disclosure, AI marker on published replies | Medium | Needs the reply read model widened past three fields                          |
| 6   | Settings IA regroup + scope labels + single property selector                    | Medium | Touches routing and the sidebar; do after the notification fix                |
| 7   | AI activity & quota section                                                      | Medium | Needs a new read port over permits/settlements/quota windows                  |
| 8   | Response performance vs `responseSlaHours` from `rollup_daily_inbox_metrics`     | Medium | Closes a loop that is currently open                                          |
| 9   | Period control + compare-to-previous                                             | Medium | Requires range plumbing through the aggregate reads                           |
| 10  | Mount AI controls in `rejected`/`publish_failed`; implement Edit & Resubmit      | Medium | Real behaviour change in the reply state machine                              |
| 11  | Feedback capture into `replyAdoptionDisposition`                                 | Low    | Small, and it starts the data collection that would justify later prompt work |
| 12  | Decide `organization_role_policy`: expose or delete                              | Low    | Stop the limbo                                                                |
| 13  | Decide `/metrics`: wire or remove                                                | Low    | Stop the permanent placeholder                                                |

Steps 2–4 are the ones I would do immediately. They are nearly free, they are the difference
between "a list of reviews" and "a reputation product", and the data has been sitting there
unused the whole time.

---

## 5. Explicitly out of scope, and why

- **A chat interface for replies.** Argued against in §2.1. The system is constrained
  selection over a versioned template catalogue; a transcript UI would misdescribe it.
- **Free-form prompt input.** The governance plane deliberately forbids user-supplied
  instructions reaching the provider; a prompt box would be an interface for something that
  must be refused.
- **Streaming token display.** The provider call is single-shot and now ~1.2 s. Streaming
  UI would add machinery for a state that barely exists.
- **Surfacing the AI governance catalogues** (`ai_operation_profiles`,
  `ai_provider_deployment_profiles`, etc.). These are migration-owned attestation records.
  They belong in an internal operator view if anywhere, not in tenant settings.
- **Changing the reply prompt or template catalogue.** Related and worth doing — the
  developer prompt references a list of template IDs it does not supply — but it moves
  attested digests and needs its own ceremony. Tracked in the AI implementation review.
