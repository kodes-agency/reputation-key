# Property setup, settings, and AI admission — exploration

**Date:** 2026-09-14 · **Status:** exploration only, no code changes. A plan follows the
grilling recorded in §6. Branch `ux/inbox-detail` is unrelated; this work will get its own branch.

## 1. The three asks

1. Redesign the property import wizard and logic, including AI enablement during import.
2. Consolidate property settings, which are scattered across five surfaces.
3. Fix the AI review-analysis admission problem: after importing a property with ~96 reviews,
   "Draft with AI" silently returned a local template because the analysis backlog and the
   interactive draft share one per-property admission budget.

## 2. Import flow today

### Shape

- Entry points: `Import Properties` on `/properties` (`property-list-page.tsx:144-152`), the
  sidebar property switcher (`manager-property-switcher.tsx:61-70`), and remediation links from
  AI settings and the portal Google-destination card. The OAuth callback returns to
  `/properties/import-google?connectionId=…`.
- Routes: `routes/_authenticated/properties/import-google/index.tsx` (discover + review) and
  `$importId.tsx` (progress). Both gated on `integration.manage` + capability
  `property.import_gbp_v2` (controlled_beta). PropertyManagers cannot import.
- Runtime state machine has three steps, `discover | review | progress`
  (`google-import-manager-contract.ts:32`). The breadcrumb renders four
  (`Select locations → Review details → Import → AI analysis`); the fourth is display-only and
  appears as soon as the first item lands (`google-import-progress-view.tsx:54-56`).
- Step "Select locations": accounts list, candidate table, client-side search over loaded rows,
  `Select all eligible locations` pages through Google in batches of 100.
- Step "Review details": one card per location with `Property name`, `Address`, `Country`
  (create rows), `Timezone`, plus two mandatory checkboxes per row (`Confirm <country>`,
  `Confirm <timezone>`). A bulk `Timezone for all rows · Apply to all` exists.
- Step "Import": parent status + four stat cards + per-item table with Retry / View property.
- Step "AI analysis": one `MerchantAiAuthorizationCard` per produced property, requires the
  account password per property, enables all three capabilities at once; "Not now" is React
  state only (`google-import-ai-onboarding.tsx:77,109-123`).

### Backend

- Server fns in `contexts/integration/server/gbp-import.ts` (discovery, start, recover, retry,
  cancel, status). Discovery content lives in provider-ephemeral Redis behind opaque handles.
- `google-import-transaction.ts:201-433` `start()` claims candidate refs, authorizes twice,
  plans batches of 100, commits saga rows + one `integration.property_import.requested` outbox
  event per batch. Item processor `google-import-v2-processor.ts:347-525` re-authorizes, creates
  or relinks the bound property, then (`:228-269`) enqueues review sync with initiator
  `google-property-import` (observations tagged `historical_onboarding`) and best-effort Pub/Sub
  subscription.
- Property built by `build-google-imported-property.ts:25-52`: name, slug `import-<itemId>`,
  timezone, address, country, Google binding, provenance `tenant_confirmed`. **Not set:**
  `defaultReplyLanguage`, responsible managers, portal, AI authorization, reply profile.
- Each synced review emits `review.created` → consumer `ai.analyze-review-event`
  (`contexts/ai/infrastructure/outbox-consumers.ts:226-231`), which starts one analysis
  operation per review immediately if the property is AI-enabled.
- The only "onboarding" construct is the org-level setup checklist read model
  (`google_connection`, `initial_review_sync`, `published_portal`, `responsible_managers`),
  shown as a one-line banner on `/properties` whose Google action points at
  `/settings/integrations`, not the import flow.

### Gotchas

1. Import is the only way to create a property; `createProperty` has no UI caller.
2. Import never emits `property.created` (only `property.google_binding.changed`), so Recent
   Activity never sees an imported property, contradicting the port comment in
   `property-command-store.port.ts:8-10`.
3. Tabbing away clears discovery content (`page_hidden` in `google-import-content-lifecycle.ts`),
   dropping the selection with "Google location details were cleared".
4. ADR 0050 §3 says discovery content lives in Redis for at most 15 minutes; code and UI copy say
   24 hours (`google-import-discovery.ts:28`, `google-import-manager-view.tsx:59-62`).
5. `submitImport` navigates to `?requestId` before calling `startPropertyImportV2`
   (`google-import-manager.tsx:138-149`); a reload mid-flight lands on a dead request id.
6. Tenant validation failures (`invalid_name`, `invalid_timezone`, …) are mapped to
   `internal_error` and shown as "Import could not be completed" with no route back to the field
   (`google-import-v2-processor.ts:78-85`).
7. `already_exists` items have no property link and no retry.
8. Authorization runs at least four times per item, including once per retry candidate on every
   status poll.
9. The AI decision after import is not durable: skip is lost on navigation; nothing records
   "decision pending" for a property.

## 3. Property settings today

Configuration for one property spans five UI surfaces and eleven tables. No screen answers
"what is configured for this property".

| Setting                                                                      | Scope                 | Where edited today                                                                                                  | Storage                                                  |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AI capabilities (enable / change / revoke, password step-up, notice version) | property              | `/settings/ai?propertyId=…` (org-level nav entry "AI & replies")                                                    | `merchant_ai_enablement`, `merchant_ai_consent_evidence` |
| Default reply language                                                       | property              | `/settings/ai` only                                                                                                 | `properties.default_reply_language`                      |
| Name, slug, timezone, country                                                | property              | **no editor anywhere** (DTO supports them)                                                                          | `properties`                                             |
| Address                                                                      | property              | written by import, never editable                                                                                   | `properties.address`                                     |
| Public display name (+3 colours)                                             | property              | **two editors**: property settings card (name only, silently writes default colours) and portal detail brand editor | `property_portal_brand_profiles`                         |
| Reply profile (greeting, sign-off, emoji policy, escalation)                 | property              | `/properties/$id/settings`                                                                                          | `property_reply_profiles`                                |
| Reply template library                                                       | property              | `/properties/$id/settings`                                                                                          | `property_reply_templates`                               |
| Responsible managers                                                         | property              | `/properties/$id/settings`                                                                                          | `property_responsible_managers`                          |
| Private feedback handling target override                                    | property              | `/properties/$id/settings`                                                                                          | inbox response-target tables                             |
| Google review response target                                                | org only              | `/settings/organization`                                                                                            | `inbox_response_target_organization_policies`            |
| Google binding disconnect, archive, remove, restore                          | property              | `/properties/$id/settings` lifecycle card                                                                           | `properties` lifecycle columns                           |
| Google connection (connect, reauthorize, disconnect)                         | org                   | `/settings/integrations`                                                                                            | `google_connections`                                     |
| Notification preferences                                                     | user × org × property | `/settings/notifications?propertyId=…` (falls back to first property)                                               | `notification_preferences`                               |
| Notification locale + timezone                                               | user × org            | same page                                                                                                           | `notification_user_settings`                             |
| Portal publication, theme, locales, localized content, approved destinations | portal                | `/properties/$id/portals/$portalId?tab=settings`                                                                    | portal tables                                            |
| Org-level AI allow switch                                                    | org                   | **env var** `BETA_ALLOWLIST_ORGS`, no UI, no table                                                                  | —                                                        |
| Org monthly AI spend cap                                                     | org                   | none; default 50 USD, no code path raises it                                                                        | `ai_cost_windows.cap_micros`                             |

Other facts:

- Settings sidebar (`settings-sidebar.tsx:41-96`) is one flat list of eight links mixing user,
  org, property and device scope with no grouping.
- `/settings/ai` holds its snapshot in `useState` and bypasses TanStack Query; the reply-language
  mutation on the same page invalidates query keys. Its Save button has a `contractChanged`
  workaround for re-versioned notices (`merchant-ai-settings-page.tsx:91-93`).
- `properties` has no type/category column, although `docs/BETA.md` §3 says unsupported
  classifications are refused.
- A prior IA audit exists at `docs/archive/2026-09-lean/design/current-state-settings-2026-08-19.md`
  ("ten routes, four scopes, one flat ungrouped list"); structurally still true.

## 4. AI admission and analysis today

### The limiter (`src/shared/db/ai/ai-budget.ts:67-81`)

| Scope key       | Limit / 60 s | Note                              |
| --------------- | ------------ | --------------------------------- |
| `global`        | 16           | one bucket for the deployment     |
| `provider`      | 16           | literal key, duplicates `global`  |
| `org:<id>`      | 8            |                                   |
| `property:<id>` | 4            | the limit that rejected the draft |

- Scopes are checked sequentially; each `check` is an unconditional Redis `INCR` before compare
  (`rate-limit/middleware.ts:98-112`). A denial at `property` has already consumed a token in
  every earlier scope, and nothing is released. Fixed window, fail-closed, no capability or
  lane axis. Review analysis and interactive reply drafting hash to the same four keys.
- Order inside `admitAiOperation`: profile → operation row `FOR UPDATE` → replay short-circuit →
  kill-switch heads (global / provider / capability) → rate limits → monthly cost reservation
  (org cap 50 USD, reserve worst case, settle actual) → stamp. The Redis limiter call runs inside
  the open Postgres transaction that holds the `FOR UPDATE` lock
  (`postgres-admission-authority.ts:83,117,160-169`).
- A second, independent throttle exists: `ai-quota.adapter.ts` (atomic Lua, per-capability,
  per-property concurrency 2/2/1, deployment rate 60/30/10 per minute, 45 s leases). The use
  cases acquire it _before_ the gateway trips the non-atomic limiter.

### Why the draft became a template

1. Import → 96 `review.created` events → `domain-events` queue with concurrency 20
   (`operational-catalogue.ts:46-50`) hammer one property's 4/min bucket. Rejections burn global
   and org tokens too, so the backlog also starves other orgs.
2. Analysis treats `provider_rate_limited` as capacity (`ai-workflow-support.ts:74-92`): never
   terminal, retry with 1 s → 30 s backoff plus BullMQ's 30 s exponential retry.
3. The internal `rate_limited` denial is renamed `provider_rate_limited` in
   `ai-provider-control/service.ts:146`. `generate-reply-suggestion.ts:584` treats that as a
   provider failure, `canOfferLocalFallback` is true, and `:593-596` returns
   `{status:'fallback', kind:'local_safe_template', reason:'provider_or_output_unavailable'}`.
4. The UI shows "Local safe starting point" with the generic sentence "A personalized draft was
   not available" (`reply-suggestion-preview.tsx:86-100`); no throttling explanation exists.
5. The reply draft does **not** read analysis output at all (inputs: review text, rating,
   language, brand display name, tone). The dependency is purely limiter contention.

### Further defects

- `claimExecution` increments `executionAttempt` before admission, so a throttled draft burns
  one of its four attempts and leaves a durable `pending` `ai_operations` row that the reaper
  never touches (it only reaps `analysis` rows).
- `reply-form.tsx:90` mints a fresh `idempotencyKey` per click, so each press creates a new
  operation row and the attempt budget never applies across clicks.
- No ADR documents the limiter scopes or numbers; ADR 0031 covers the content boundary only.

## 5. Draft direction (pre-grilling; superseded where §6 decides otherwise, see docs/plan/property-setup-plan.md)

### A. Durable per-property setup state

Reframe "import" as "property setup". A per-property read model derives most steps from existing
facts (Google binding, first review sync, reply language, AI enablement, responsible managers,
portal) and adds one new durable fact: the AI decision (`pending | deferred | enabled`), since
"not now" is currently lost. The wizard, the property settings hub, the property overview banner
and the inbox composer all read this model.

### B. Wizard shape

Outer frame: a stepper (diceui `stepper`, built on `radix-ui`, matching the vendored primitives)
with durable, resumable steps: Connect Google → Choose locations → Confirm details → Import →
Set up properties. Inner per-property setup questions use the new shadcn `Questionnaire`
(Radix variant; designed for fixed/freeform/skippable question flows, keyboard shortcuts,
controlled navigation). It fits reply language, AI capabilities, responsible manager, possibly
property kind; it does not fit the candidate table, progress view or password step-up, which
stay bespoke. Multi-property imports get "apply to all" defaults.

### C. Settings information architecture

- `/properties/$id/settings` becomes the single property hub with sections: Profile (name,
  country, timezone, public display name), Google (binding, sync health, disconnect), Replies
  (language, reply profile, templates), AI (capabilities, consent, analysis coverage, erase),
  People (responsible managers), Targets (private feedback override; org Google target shown as
  inherited), Danger zone (archive, remove, restore).
- `/settings/ai` becomes an org-level AI overview (properties × state × coverage × spend vs cap)
  linking into each property's AI section; reply language leaves it.
- Settings sidebar grouped by scope: You (Profile, Security, Preferences, Notifications) and
  Organization (Organization, Members, Integrations, AI overview).
- The duplicate brand editor collapses to one owner.

### D. Admission redesign

1. One atomic admission: a single Lua script that checks every scope and increments only when
   all pass; a denial consumes nothing.
2. Add a lane axis (`interactive` for reply drafting and on-demand analysis, `background` for
   backfill analysis and trends) with reserved interactive capacity at global, org and property
   scope. Merge with `ai-quota.adapter.ts` so there is one admission authority.
3. Admit before claiming: a throttle denial is not an execution attempt and gets its own code
   (`admission_throttled`), never `provider_rate_limited`.
4. Reply use case returns `unavailable('busy', retryAt)` on throttle; the composer shows "AI is
   busy with imported reviews, retry in N s" and offers the template as an explicit choice.
   Optional bounded server-side wait for an interactive slot.
5. Backfill pacing: `historical_onboarding` reviews do not fan out into 20 concurrent
   consumers; the enrollment sweep drains them at the background rate with visible progress
   (analyzed / candidate / failed / verified-through), which the AI context doc already lists as
   a product gap.
6. Derived draft idempotency per (review revision, tone, brand profile version, user) within the
   in-flight window; explicit Regenerate mints a new operation.
7. Limiter call moves outside the `FOR UPDATE` transaction; reaper also reaps stale `reply`
   rows.
8. New ADR documenting lanes, scopes and numbers.

## 6. Decisions (filled during grilling)

| #   | Question                                                                                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Date       |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Does "import" become a durable per-property setup state, with the wizard as one view of it? | Yes. Per-property setup model; most steps derived from existing facts; one new durable fact for a deferred AI decision. Wizard resumable from the property page; settings hub and inbox composer read the same model.                                                                                                                                                                                                                                                                                                                                                                             | 2026-09-14 |
| 2   | Which steps make up a property's setup, and which does the wizard ask?                      | Seven steps: Google linked (fact), reviews synced (fact), reply language (asked, prefilled from country when in the 24-language catalogue, else English), AI decision (asked: enable or defer), responsible manager (asked, default importing admin when eligible), reply voice (later, nudged), portal published (later). Nothing blocks; skipped steps stay pending behind a property setup banner; deferred AI counts as decided. Multi-property imports answer once with apply-to-all and per-property overrides. No property kind this round.                                                | 2026-09-14 |
| 3   | May one consent ceremony authorize AI for all properties in an import batch?                | Yes (option B). One notice listing every property by name, capabilities chosen once with per-property overrides, one server request running one enable command per property. Enablement and evidence rows stay per property and carry a shared ceremony id. Requires a notice version bump and a batch server function. Per-property editing in settings unchanged.                                                                                                                                                                                                                               | 2026-09-14 |
| 4   | Drop the password from AI consent?                                                          | Yes, everywhere (option B). Consent = notice rendered at current version/digest + explicit AccountAdmin acknowledgement checkbox + evidence row (actor, notice version, digest, ceremony id). Notice schema `requiresStepUp` flips to false on the same version bump as decision 3; BETA.md sentence updated; step-up port stays in the use case for a future proof. Recorded as a deliberate consent-assurance change in the notice changelog.                                                                                                                                                   | 2026-09-14 |
| 5   | How does "Confirm details" keep explicit confirmation without two checkboxes per row?       | Option B. One editable summary table (name, address, country, timezone). Country from Google; timezone derived when the country has one zone, otherwise empty and flagged; a single "I have checked these details" acknowledgement plus Start import stamps profileConfirmedAt/By on every row. Empty timezone or unknown country blocks the batch until picked. Browser timezone is no longer a default. Needs a small country-to-zones table. Relink rows keep their profile unless overwrite is opted in.                                                                                      | 2026-09-14 |
| 6   | Discovery content lifetime and tab-away clearing?                                           | Option B. Amend ADR 0050 §3 to the real model: 24-hour server-side checkpoint gated by a 30 s lease renewed every 10 s while the page is open (rationale from commit 5007e70b, 2026-08-28). Hiding the tab pauses lease renewal and polling but keeps the selection; returning renews the lease and resumes. Content still clears on route leave, tenant/connection change, or genuine checkpoint/lease expiry. Performance data keeps its own 15-minute limit.                                                                                                                                   | 2026-09-15 |
| 7   | Manual property creation without Google?                                                    | No (option A). Google import stays the only creation path this round; empty-state copy becomes "Import your first property from Google". The setup model keeps "Google linked" as an ordinary step so a manual path can be added later.                                                                                                                                                                                                                                                                                                                                                           | 2026-09-15 |
| 8   | Who runs the wizard and who finishes pending setup later?                                   | Option B. Discovery, confirm and import stay AccountAdmin (integration.manage + property.import_gbp_v2). Reply language and responsible manager steps can be finished by any PropertyManager with access to the property, from the setup banner or settings hub (property.update). AI decision stays AccountAdmin only; PropertyManagers see "needs an AccountAdmin" on that step.                                                                                                                                                                                                                | 2026-09-15 |
| 9   | Where does AI enablement live; fate of /settings/ai?                                        | Option B. Per-property AI editing (capabilities, consent, coverage, erase) moves into the property settings hub. /settings/ai becomes a read-only organization AI overview: properties × AI state × analysis coverage × re-consent flag × month spend vs cap, each row linking to that property's AI section. Reply language leaves the page. Sidebar label "AI overview".                                                                                                                                                                                                                        | 2026-09-15 |
| 10  | Structure of the property settings hub?                                                     | Option B. Child routes under /properties/$id/settings, one per section, with a left section nav: Profile, Google, Replies, AI, People, Targets, Danger zone. Each section has its own loader. Setup checklist strip shows above the open section while any step is pending. Deep links from inbox composer, AI overview and setup banner target sections.                                                                                                                                                                                                                                         | 2026-09-15 |
| 11  | Profile section scope and owner of the public display name?                                 | Option A. Profile edits workspace name, country, timezone via the existing update DTO; address read-only "from Google"; slug hidden. Profile becomes the single owner of the public display name; the portal brand editor keeps colours only and links to Profile for the name. Internal name and public display name stay separate, labelled "Workspace name" and "Public display name".                                                                                                                                                                                                         | 2026-09-15 |
| 12  | Settings sidebar organisation?                                                              | Option B. Two labelled groups: "You" (Profile, Security, Preferences, Notifications) and "Organization" (Organization, Members, Integrations, AI overview). Property settings reachable only from the property nav. Notifications stays under You with its property selector.                                                                                                                                                                                                                                                                                                                     | 2026-09-15 |
| 13  | Composer behaviour when a draft cannot be admitted?                                         | Option C. Never substitute a template silently. Server waits a few bounded seconds for an interactive slot, then returns a distinct busy outcome with retryAt. Composer shows "AI is busy analysing imported reviews for this property", a countdown retry, and a separate "Use a template instead" action. Genuine provider failures get the same explicit treatment with their own wording.                                                                                                                                                                                                     | 2026-09-15 |
| 14  | Consolidate throttles into one atomic admission with lanes?                                 | Option B. One admission authority on the quota adapter's atomic Lua shape with scope × lane × capability axes, tracking concurrency and rate; the budget limiter and duplicate provider key go. Two independent buckets per scope. Starting budgets per minute: global 12 background / 8 interactive; org 6 / 4; property 3 / 3. Background = analysis + trends; interactive = reply drafting + on-demand analysis. Admission before execution claim (a throttle denial is not an attempt); Redis call outside the Postgres lock; numbers recorded in a new ADR and tuned from admission metrics. | 2026-09-15 |
| 15  | Backlog pacing and queue-jumping?                                                           | Option C. Historical-onboarding reviews and every backfill stop fanning out per event; they become enrollment work that a drainer admits at the background rate, newest review first, with analysed/pending/failed counts on the property AI section and the wizard progress step. Live Pub/Sub reviews keep the immediate path. Opening a review with pending analysis in the inbox requests that one analysis on the interactive lane; operations are fenced by revision so duplicates replay; the drainer skips it.                                                                            | 2026-09-15 |
| 16  | Draft click identity and Regenerate?                                                        | Option B. The composer mints one idempotency key per compose session and tone, reused for every click and for the busy retry; a click while the operation is executing returns in-flight state. Regenerate mints a new key deliberately. Server keeps validating the key against review revision and brand version. Reaper covers reply rows too.                                                                                                                                                                                                                                                 | 2026-09-15 |
| 17  | Wizard building blocks?                                                                     | Option B. Vendor the diceui stepper (Radix) for the outer frame with steps Connect Google, Choose locations, Confirm details, Import, Set up properties. Vendor the shadcn Questionnaire (Radix variant) for the last step: reply language (select inside the item), AI decision with capabilities as a multiple-choice item, responsible manager from eligible members; "apply to all" toggle with per-property overrides. Discovery table, confirm-details table and progress view stay bespoke.                                                                                                | 2026-09-15 |
| 18  | Delivery order?                                                                             | A (AI admission + composer: decisions 13–16) first, then B (setup state + settings hub: 1, 9–12), then C (wizard + consent batch: 2–8, 17). Each its own branch and PR series off main. Admission ADR ships in A; ADR 0050 amendment and notice version bump ship in C. Plan: docs/plan/property-setup-plan.md.                                                                                                                                                                                                                                                                                   | 2026-09-15 |
| 19  | Should the public display name default, and does the wizard ask it?                         | Yes to both. An imported Property starts with its confirmed name as the public display name (existing Properties are backfilled), so AI reply drafts work straight after import. "Set up properties" asks the name first with that default filled in; a person's save confirms it, and a skipped question keeps the automatic name. The field stays separate from the workspace name (decision 11).                                                                                                                                                                                               | 2026-09-15 |

## 7. Constraints to respect

- `docs/BETA.md` §3 "AI": all three capabilities stay off until AccountAdmin AI Authorization;
  analysis and drafting independent, trends requires analysis; disabling fences in-flight work.
- `docs/BETA.md` §3 "Google and Review": select-all imports in resumable batches of at most 100;
  historic onboarding imports excluded from Response Target timing.
- ADR 0050 §3: discovery content only in request/browser memory and provider-ephemeral Redis;
  browser DTOs carry opaque handles; a durable import stores the manager's explicitly confirmed
  profile.
- ADR 0031: every external AI operation requires an active property-scoped Merchant AI opt-in
  and matching epoch; fail closed on any unclassified operation.
- ADR 0032: delayed work rechecks policy at execution.
- `merchant-ai-notice-contract.ts`: notice version `merchant-ai-notice-2026-09-09.v1`, CTA
  literal `Enable all three AI features for {propertyName}`, `requiresStepUp: true`. Any batch
  consent needs a notice contract change.
