# Property setup, settings hub, and AI admission — plan

**Date:** 2026-09-15 · **Status:** agreed in grilling, not started. Inputs: the eighteen decisions
in [`property-setup-exploration.md`](./property-setup-exploration.md) §6; facts in its §2–§4.
Nothing here is implemented. Each workstream starts on its own branch off `main`.

## 0. Ground rules

- Order: **A** AI admission and composer → **B** setup state and settings hub → **C** wizard and
  consent batch (decision 18). B does not wait on A; C needs both.
- Branches: `ai/admission-lanes`, `ux/property-settings-hub`, `ux/property-setup-wizard`. Not on
  `ux/inbox-detail`.
- Governance lands with the code that needs it: ADR 0057 in A; ADR 0050 amendment, notice
  version bump and the BETA.md sentence in C.
- Every use case gets colocated unit tests; every store change gets a PostgreSQL integration
  test; Redis scripts get integration tests against a real Redis; UI gets stories plus a browser
  pass at 390 and 1280 px. Coverage stays at or above the repo's 80% gate.
- Commits: `type(scope): description`. One PR per phase below, small enough to review in one
  sitting.

---

## Workstream A — AI admission lanes and an honest composer

**Goal.** A manager can draft a reply while a property's review backlog is being analysed, the
backlog drains at a predictable pace with visible progress, and a template is never substituted
without the manager choosing it. Decisions 13, 14, 15, 16.

### A1. One atomic admission authority with lanes (decision 14)

New module `src/shared/ai-admission/` replacing two throttles:

- `lane-admission.ts` — Redis Lua script derived from
  `contexts/ai/infrastructure/adapters/ai-quota.adapter.ts` (already atomic, sorted-set rate and
  concurrency, 45 s leases). Axes: scope `global | org:<id> | property:<id>` × lane
  `interactive | background`, plus the existing per-capability concurrency caps. The script reads
  every scope, admits only when all pass, and adds the token to every scope in the same call. A
  denial writes nothing and returns the earliest `retryAfterEpochMillis` across scopes.
- `lane-budgets.ts` — one frozen table, referenced by ADR 0057:

  | Scope        | Background per minute | Interactive per minute |
  | ------------ | --------------------- | ---------------------- |
  | global       | 12                    | 8                      |
  | organization | 6                     | 4                      |
  | property     | 3                     | 3                      |

  Lane per profile: `reply-suggestion-v1` interactive; `review-analysis-v2` background unless
  requested on demand (A3); `property-trend-v1` background.

- `src/shared/db/ai/ai-budget.ts` — delete `withinRateLimits` and the literal `provider` key.
  `admitAiOperation` keeps kill-switch heads and monthly cost reservation only. The request
  binding carries the lane-admission token so the gateway can assert admission happened
  (`ai-provider-control/admission-service.ts`).
- Use cases acquire lane admission **before** `operations.claimExecution`, exactly where they
  acquire the quota lease today (`generate-reply-suggestion.ts:531`,
  `analyze-review-event.ts:634`). A throttle denial therefore never increments
  `executionAttempt` and never creates a `pending` row.
- Denial code `admission_busy` with `retryAfterEpochMillis`. `ai-provider-control/service.ts:146`
  stops mapping any internal denial to `provider_rate_limited`; that code is reserved for the
  provider's own 429.
- Delete `ai-quota.adapter.ts` and `AiQuotaPort` once both use cases are moved; composition in
  `src/composition/ai-egress-runtime.ts` and `provider-runtime.ts` wires the new authority.
- Metrics: one counter `ai_admission_decisions_total{scope,lane,outcome}` and a histogram of
  wait time for the bounded wait in A2.

Tests: Lua script against real Redis (denial consumes nothing in any scope; interactive admits
while background is saturated; lease release; window rollover); `ai-budget.integration.test.ts`
loses its `limiterAllows` fake; a source-scan test that the string `provider_rate_limited` is
produced only from a provider response.

### A2. Reply use case and composer (decisions 13, 16)

- `generate-reply-suggestion.ts`: bounded wait for an interactive slot, 4 s total in 500 ms
  steps, then `unavailable('busy', retryAt)`. Remove the silent fallback branch at `:584-596`;
  every provider or output failure returns `unavailable(code, retryAt)` with
  `templateAvailable: true`. The existing `templateOnly` input (`:72`) becomes the explicit
  template path the composer calls on "Use a template instead".
- `components/inbox/reply-form.tsx:90`: mint one idempotency key per compose session and tone
  when the session opens; reuse it for every click and the busy retry. A "Regenerate" action
  mints a new key. Server keeps validating the key against review revision and brand version.
- `use-reply-suggestion.ts`: states `idle | requesting | ready | busy | failed`, each with
  `retryAt` where relevant. `reply-suggestion-preview.tsx`: busy card "AI is busy analysing
  imported reviews for this property" with a countdown retry and a separate template action;
  failure card with its own wording and the same template action.
  `reply-suggestion-contract.ts:83-84` gains messages for `busy` and each failure code.
- `ai-operation-execution-reaper.ts`: reap `reply` rows as well as `analysis` rows.

Tests: use-case tests for busy, failure, template-only and key reuse; hook tests for state
transitions; stories for every card state; a browser check that a busy result never populates
the editor.

### A3. Backlog pacing and on-demand analysis (decision 15)

- `contexts/review/application/use-cases/sync-reviews.ts:329`: `review.created` gains
  `observationOrigin: 'historical_onboarding' | 'ongoing'`, an identifier-free fact registered
  in `content-free-facts.test.ts`. The origin already exists on the observation
  (`sync-property-reviews.job.ts:186-190`).
- `contexts/ai/infrastructure/outbox-consumers.ts:106-146`: `ongoing` keeps the immediate path.
  `historical_onboarding` records an enrollment candidate (new store method
  `enqueueCandidate`) and receipts the event as `applied` without starting an operation. The
  same routing applies to every `ai.review_analysis.backfill_requested` producer.
- Drainer: extend `advance-review-analysis-enrollments.ts` (or a sibling
  `drain-review-analysis-backlog.ts`, registered in `event-job-catalogue.ts` on the `background`
  queue, `every:60000`). Per property per tick it emits at most the property's background budget
  of analysis operations, newest review first, skipping candidates already started. Each
  enrollment head keeps a cursor so a restart resumes.
- Progress read: `readReviewAnalysisProgress(propertyId)` in the AI public API, extending the
  enrollment readiness read: `analysed`, `pending`, `failed`, `verifiedThrough`. Consumed by the
  property AI section (B2), the org overview (B3) and the wizard progress step (C5).
- On demand: `get-inbox-item-detail.ts:126` already loads `analysis`. When it is `null`, the
  property has `review_analysis` enabled and a candidate is pending, the server function calls a
  new AI public-API command `requestReviewAnalysisNow`, which starts that one analysis on the
  interactive lane. Operations stay fenced by revision, so the drainer's later attempt replays.

Tests: consumer routing by origin; drainer emits newest first and respects the budget; on-demand
request is idempotent against a running operation; progress counts against a seeded property.

### A4. ADR 0057 — AI admission lanes

`docs/adr/0057-ai-admission-lanes.md`: scopes, lanes, the budget table, atomic admit-or-nothing,
admission before execution claim, denial codes, backlog pacing and on-demand priority, and the
rule that tuning changes the table in `lane-budgets.ts` and this ADR together. Add the row to
`docs/adr/README.md`.

### Acceptance for A

- Import a property with 100 reviews, enable AI, open the inbox, click Draft with AI: a
  personalised draft arrives inside the bounded wait.
- Saturate the background lane in a test and prove an interactive request is admitted.
- No path produces a template without an explicit template request.
- Backlog drains at the property background rate with progress counts visible.

---

## Workstream B — Setup state and settings hub

**Goal.** One per-property setup model that the settings hub, the property page, the properties
list and the inbox composer all read, and one place to configure a property. Decisions 1, 9, 10,
11, 12.

### B1. Per-property setup model (decision 1)

- Read model in the reporting context beside the existing checklist:
  `contexts/reporting/application/use-cases/get-property-setup.ts` with
  `ports/property-setup.repository.ts` and a repository mirroring
  `setup-checklist.repository.ts`, which already joins cross-context tables. Steps and sources:

  | Step                  | Status source                                             |
  | --------------------- | --------------------------------------------------------- |
  | `google_linked`       | `properties.google_binding_state`                         |
  | `reviews_synced`      | first successful sync for the current source epoch        |
  | `reply_language`      | `properties.default_reply_language`                       |
  | `ai_decision`         | `merchant_ai_enablement.state` or the new deferred marker |
  | `responsible_manager` | `property_responsible_managers`                           |
  | `reply_voice`         | `property_reply_profiles` row present                     |
  | `portal_published`    | a published portal exists                                 |

  Statuses: `complete | pending | deferred | needs_admin | waiting`. Milestones stay monotonic
  like the org checklist.

- Deferred AI decision in identity: `merchant_ai_enablement` gains `decision_deferred_at` and
  `decision_deferred_by` (nullable); command `deferMerchantAiDecision` writes them without
  consent, evidence or epoch change; `enable` clears them. Migration plus a domain test that
  deferral never touches capabilities.
- Surfaces: `PropertySetupStrip` component; a banner on the property overview while any step is
  pending; a status badge on the properties list; the inbox composer reads `ai_decision` and
  shows "AI is off for this property" with a link to the AI section instead of the current
  `not_authorized` wording.

**Implemented on `wip/ps-identity-setup` (2026-09-15), with these departures:**

- **Deferral is a side table, not columns.** `merchant_ai_enablement` is a fenced consent head:
  each row references a consent-evidence head, carries a notice version/digest and capability
  and source epochs, and is written only by `apply_merchant_ai_transition_v1`. A deferral has
  none of those, so it lives in `merchant_ai_decision_deferrals` (migration 0015): one row per
  Property, both foreign keys cascading with the Property. The defer command
  (`deferMerchantAiDecisionFn`) reuses enable's authorization, locks the Property row enable also
  locks first, refuses with `already_enabled` while AI is enabled and keeps the first deferral on
  a repeat; enable deletes the row in its own transaction. The snapshot DTO gains
  `decisionDeferredAt`.
- **No milestones for the per-Property model.** Statuses derive from current facts on every read;
  a step that stops holding needs attention again. `derivePropertySetupSteps` (reporting domain)
  also returns `asked` and `section` per step, and `attentionCount` counts `pending` and
  `needs_admin`.
- **Evidence choices.** `reviews_synced` reads a completed `review_provider_snapshot_runs` row for
  the current source epoch, the evidence behind the org checklist's initial sync. Terminal runs
  are retained 30 days and sync recurs within hours. No index covers completed runs by Property
  yet, so a partial index on completed runs by organization, Property and source epoch is a
  candidate follow-up. `portal_published` needs a `published` Portal with an open publication
  activation; Portal health is not a setup step.
- **Open question: who holds `ai.manage`.** Decision 8 keeps the AI decision AccountAdmin-only,
  and the setup rule reports `needs_admin` to a PropertyManager as agreed. The permission table
  and the transition function, however, also give a PropertyManager `ai.manage` on granted
  Properties, and defer and the B3 overview reuse that authority unchanged. Narrowing it is a
  permission change for C2 or a follow-up, not part of this slice.

### B2. Settings hub as child routes (decisions 10, 11)

- `routes/_authenticated/properties/$propertyId/settings.tsx` becomes the layout with the
  section nav and the setup strip. Children: `settings/index.tsx` (redirects to `profile`, or to
  the first pending step while setup is incomplete), `profile.tsx`, `google.tsx`, `replies.tsx`,
  `ai.tsx`, `people.tsx`, `targets.tsx`, `danger.tsx`. Each has its own loader and query keys.
- Card moves, no behaviour change: reply profile and template library → Replies; responsible
  managers → People; private feedback target → Targets, with the org Google target shown as
  inherited; lifecycle card → Danger zone; public display name → Profile.
- New: Profile form for workspace name, country, timezone through the existing
  `updateProperty` DTO; address read-only "from Google"; slug hidden. Reply language card moves
  from `/settings/ai` to Replies. Google section shows binding state, last sync, disconnect
  (moved out of the lifecycle card) and a relink link into the import flow.
- AI section: `MerchantAiAuthorizationCard` moves here unchanged, password included until C1
  removes it, plus the progress counts from A3. No erase control exists today; none is added.
- `portal-property-brand-editor.tsx` keeps colours only and links to Profile for the name.
  `property-public-display-name-card.tsx` stops writing default colours.
- Update the thirteen links that target `/settings/ai` or the old settings page, including the
  two "Review property import" remediation links and the inbox "Set property language" link.

### B3. Organization AI overview (decision 9)

- `/settings/ai` becomes read-only: a table of properties with AI state, capabilities, analysis
  coverage from A3, a re-consent flag when the stored notice version differs from the served one,
  and month spend against the org cap from `ai_cost_windows`. Rows link to the property's AI
  section. New identity server function `listMerchantAiOverview`; the route stops calling
  `getMerchantAiAuthorizationFn` and the snapshot `useState` goes.
- **Read implemented on `wip/ps-identity-setup` (2026-09-15):** `listMerchantAiOverviewFn()`
  returns `{ properties }` (state, capabilities, notice version, `reconsentRequired`,
  `decisionDeferredAt`, `googleBindingActive`) so coverage and spend can join the same object
  later; `identityKeys.merchantAiOverview()` is its cache key. The route and table are not built.

### B4. Settings sidebar (decision 12)

- `settings-sidebar.tsx`: two groups, "You" (Profile, Security, Preferences, Notifications) and
  "Organization" (Organization, Members, Integrations, AI overview).

### Acceptance for B

- Every property setting from the exploration table is editable from exactly one section.
- A property with a deferred AI decision shows no nag on the strip and a nudge in the AI section.
- The org overview lists every property with correct state and spend for a seeded org.
- No link in the app points at a removed route.

---

## Workstream C — Wizard and consent batch

**Goal.** Importing is a resumable setup flow that ends with configured properties, and a
multi-property import asks each question once. Decisions 2 to 8 and 17.

### C1. Notice contract v2 (decisions 3, 4)

- `merchant-ai-notice-contract.ts`: new version, call-to-action template that names one or
  several properties, `requiresStepUp: false`, and a changelog comment recording the batch
  ceremony and the deliberate removal of the password as consent assurance. Recompute the digest.
- `merchant-ai-authorization.schema.ts` CHECK constraints gain one `(version, digest)` arm on
  both tables; migration. `docs/BETA.md:23` sentence updated.
- Effect: every enabled property shows the re-consent flag from B3 until re-granted.

### C2. Batch consent command (decisions 3, 4, 8)

- Identity use case `enableMerchantAiForProperties`: input `propertyIds`, `capabilities`,
  `acknowledgement { noticeVersion, noticeDigest }`, idempotency key. Verifies the
  acknowledgement matches the served notice, authorizes each property, and runs the existing
  per-property enable inside one transaction: one enablement row, one evidence row and one
  outbox event per property, all carrying a new `ceremony_id` column on
  `merchant_ai_consent_evidence` (migration). `verifyStepUp` stays in the dependency type as a
  no-op proof hook for a future policy.
- Server function `enableMerchantAiForPropertiesFn`, AccountAdmin only. Single-property enable,
  change and revoke drop the password field and take the same acknowledgement.

### C3. Confirm-details table (decision 5)

- New `src/shared/domain/country-timezones.ts`: ISO country → IANA zones, single-zone countries
  resolve automatically.
- `google-import-review-model.ts`: browser timezone is no longer a default; timezone derives from
  country or stays empty and flagged. Replace per-row cards, fields and confirmations
  (`google-import-review-form.tsx`, `-fields.tsx`, `-confirmations.tsx`) with one editable table
  and a single "I have checked these details" acknowledgement. Keep bulk timezone apply.
- DTO: per-item `countryConfirmed` and `timezoneConfirmed` become a batch
  `profileAcknowledged` plus per-item completeness validation; bump
  `GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION` to 4. The processor stamps `profileConfirmedAt/By`
  from the batch act. Relink rows keep the existing overwrite opt-in.

### C4. Discovery lifecycle and ADR 0050 amendment (decision 6)

- `use-google-import.ts:133-136` and `google-import-content-lifecycle.ts`: `page_hidden` pauses
  lease renewal and polling instead of clearing; returning renews the lease and resumes; a lease
  that cannot be renewed clears as today. Remove `page_hidden` from the clear-reason union.
- ADR 0050 §3 "Import discovery": describe the 24-hour lease-gated checkpoint with the rationale
  from commit `5007e70b`; Performance keeps 15 minutes. UI copy in
  `google-import-manager-view.tsx:59-62` matches.

### C5. Wizard frame and setup step (decisions 2, 7, 8, 17)

- Vendor primitives into `src/components/ui`: diceui `stepper` and the shadcn `questionnaire`
  (Radix variant). Pin versions in the vendoring commit.
- New `src/components/features/property-setup/`: `SetupWizard` (stepper frame with steps Connect
  Google, Choose locations, Confirm details, Import, Set up properties), `SetupQuestionnaire`
  (reply language as a select inside an item, AI decision as a multiple-choice item with the
  three capabilities, responsible manager from eligible members), `ApplyToAllToggle` with
  per-property overrides. The existing discovery panel, the C3 table and the progress view are
  mounted inside the frame; the four-crumb breadcrumb goes.
- Progress step shows the A3 counts once AI is enabled. "Set up properties" writes reply language
  through `updateProperty`, managers through `updatePropertyResponsibleManagers`, and AI through
  C2 or the B1 deferral. Skipping any item leaves the step pending; the setup strip from B1 takes
  over on the property page.
- Entry points: `/properties` empty state reads "Import your first property from Google"; the
  setup checklist Google action points at the import flow; PropertyManagers reach the pending
  language and manager steps from the strip.

### C6. Defects fixed on the way

- `google-import-manager.tsx:138-149`: call `startPropertyImportV2` first, navigate on success.
- `google-import-v2-processor.ts:78-85`: `invalid_*` map to a `tenant_profile_invalid` outcome
  carrying the field, presented with a link back to the table row.
- `google-import-v2-contract.ts:316-320`: `already_exists` items carry the existing property id.
- Import emits `property.created` alongside the binding event so Recent Activity sees imported
  properties (`property-google-binding-store.ts:369-428`); or the activity consumer subscribes to
  `property.google_binding.changed` with `change:'created'`. Pick the former; the port comment
  already promises it.

### Acceptance for C

- Import twenty locations: one acknowledgement on the table, one consent ceremony, three
  questions, every property ends with language, manager and an AI decision.
- Tab away during selection and return: selection intact.
- A reload mid-submit lands on a real import.
- ADR 0050 matches the code; the notice changelog records the password removal.

---

## Cross-cutting

**Risks.**

- The notice bump forces re-consent on every enabled property; announce it in the release note
  and rely on the B3 flag.
- Redis Lua changes need the real-Redis integration suite, not fakes.
- The route restructure in B2 touches thirteen links; a link-check test guards them.
- Questionnaire is new upstream; vendoring pins it, and its composition API is what C5 relies on.

**Out of scope, by decision.** Property kind (2), manual creation (7), merging workspace and
public names (11), notification rows in the hub (12), editing the spend cap (9), an AI erase
control (none exists).

**Metrics to watch after A ships.** Admission decisions by lane and outcome, bounded-wait
histogram, backlog drain time per property, template-choice rate in the composer.
