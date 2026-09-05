# State of the app — comprehensive review, 2026-09-02

**Subject:** `rep-key` on branch `ci/split-check-job`. The branch moved during the review: findings were gathered against `dc1fc97e`/`3f76a99c` and re-verified at **`0edbc466`** (3 commits ahead of `origin/main` `1425966f`). Where a commit landed mid-review it is named at the finding.
**Measured against:** [`docs/comprehensive-beta-implementation-program-2026-08-25.md`](../../docs/comprehensive-beta-implementation-program-2026-08-25.md) (the execution authority — 42 packages, §3 fixed product/architecture contract), [`docs/program-completion-plan-2026-08-29.md`](../../docs/program-completion-plan-2026-08-29.md), and the pre-rewrite finding register `/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md` (842 lines) whose central verdict the rewrite existed to falsify:

> "The repository has built more architecture, governance, and product surface than it consistently wires, activates, tests, and documents… the principal risk is **false confidence**."

**Method.** Ten parallel specialist reviews (architecture, contexts, product, UI/UX, data, tests, gates, security, operations, documentation), each required to cite `path:line`, to trace mechanisms to a real call path rather than to a catalogue row, and to price machinery in numbers. Every finding used below was re-verified by me directly against source, git, or a local run — the verification log is §10. The ten reports total 3,360 lines and are indexed in §12.

---

## 1. Verdict

**The rewrite fixed the specific defects it targeted and reproduced the pattern that produced them.**

Both halves are true and neither cancels the other.

The concrete pre-rewrite defect register is largely closed, and closed properly — not suppressed. CSRF middleware is installed; password change and reset revoke other sessions with a real-database test; `replies.review_id` is `onDelete: 'restrict'` and the delete path is marked unreachable; the job registry throws on duplicate registration instead of silently overwriting; every production TypeScript module is now inside a typecheck project (4,162 modules across 3 projects); the dashboard no longer fabricates a 0% trend by comparing a period to itself, and there is a test that names the old bug. Tenant isolation now has exactly one enforcement mechanism, 24 of 25 sampled server functions pass all four isolation checks, and the single deviation sits behind a compile-time-blocked capability. The AI egress path prevents prohibited content from reaching a provider with a closed five-field `.strict()` schema plus reviewer-name canonicalization plus a digest fence plus an Ed25519 settlement receipt — a code path, not a promise. `src/shared/governance/capability-fate.ts` is 165 lines that state, per capability, what the product does, why, and what would have to be true to change it. That file is the best artifact in the repository.

And: in fifteen days the codebase roughly doubled. Production source grew by a net **+188,477 lines** and tests by **+213,633**, against **157,234 total deletions** repository-wide — deletions were **~15% of additions**, and only two contexts (`badge`, `leaderboard`) net-shrank. Forty-eight percent of classified commits were scoped to machinery (`e2e`, `governance`, `release`, `ci`, `program`, `legal`, `operations`, `architecture`, `railway`, `audit`) rather than to the product. The `fix`-to-`feat` ratio was 2:1 — 236 fixes against 118 features, on code that was itself days old. By the program's own three-axis definition of completion, **zero of 42 packages are closed**: implementation self-reports 36/42, repository verification is `in_progress` for 42/42, and external verification is `blocked`/`not_started` for all 34 that require it. The ledger asserting that is 159 commits stale.

The clearest single illustration is not a metric. It is this comment, in a test helper:

> "the UI reads `commandRevision` when the page loads and submits it back with the next command (`inbox-detail-manager-actions.tsx:43`). A bump landing between the load and the click makes an ordinary interaction fail with `revision_conflict`, which surfaces as **an unhandled page error**… Measured on 2026-08-31: **~50% of local runs**."
> — `e2e/helpers/fixtures.ts:176-183`

A real, reproducible, user-facing defect was diagnosed to the exact line. The remedy shipped was a 45-second wait loop in the test harness (`e2e/helpers/fixtures.ts:200-233`). `grep revision_conflict src/components src/routes` returns exactly one match, in a `.stories.tsx` type union. The product path is unchanged. A manager who opens an inbox item and clicks within one outbox-relay tick still gets an unhandled page error.

That is the shape of the problem now: **the machinery around the product is healthier than the product**, and the machinery is where the last two weeks of effort went.

---

## 2. Scoreboard against the plan's own definition of done

§2 of the program: _"A package is complete only when its behavior, migration, operations, documentation, and evidence agree."_

| Axis                    | State                                                                                    | Source                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Implementation          | 36 complete / 6 in progress (`ARC-03`, `IBX-01`, `LIF-01`, `CNV-01`, `LEG-01`, `REL-01`) | `docs/release-evidence/review/comprehensive-program-status-2026-08-26.json` |
| Repository verification | **0 complete** — `in_progress` for all 42                                                | same                                                                        |
| External verification   | **0 complete** — 26 `blocked`, 8 `not_started`, 8 `not_required`                         | same                                                                        |
| Ledger freshness        | `baselineSha: d377da03`, `assessedAt: 2026-08-29` → **161 commits behind HEAD**          | `git rev-list --count d377da03..HEAD`                                       |

Headline per axis. The ten reports carry **169 individually evidenced findings** between them (`grep -cE '^### '` per file, README excluded); the twelve below are the cross-axis set that actually changes decisions.

| Axis         | Headline                                                                                      | Worst finding                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Security     | No reachable exploit found. Machinery strong; root-level paperwork is a pre-rewrite fossil    | `SECURITY-AUDIT-REPORT.md` asserts unfixed P1 tenant defects and cites three deleted files            |
| Product      | Source loops are real and durable; no live proof any of them completes for the one tenant     | Dashboard presents false business facts on an ON core capability                                      |
| Architecture | Real static boundaries; deployable isolation is test-only for web and operator                | 311 `getContainer()` calls; `createWebContainer`/`createOperatorContainer` used only by test fixtures |
| Contexts     | Path-level reach-through fixed; semantic ownership still diverges                             | Two live response-timer authorities; Dashboard reads the legacy one                                   |
| Data         | Migration authority and AI reachability improved; convergence unfinished                      | Three rollup jobs still scheduled over four tables with zero readers                                  |
| Tests        | Strong local evidence; no end-to-end proof of the running product                             | Deployed "critical journeys" are anonymous health/render smoke                                        |
| Gates        | The CI shard split is the cleanest win in the rewrite; gate governance still self-contradicts | `pnpm gate` is unwired; Gate F is structurally impossible for this beta                               |
| Operations   | Release _design_ is fail-closed and good; production is an exception deployment outside it    | Platform-green while `jobs.ready=false` with 19 dead letters and nobody paged                         |
| UI/UX        | Half the "computes more than it shows" diagnosis is cured                                     | Flagship Overview contradicts §3.6 four independent ways                                              |
| Docs         | Frozen baseline and precedence chain are real; nine of 23 guides are inaccurate               | Active authorities contradict the fixed product contract                                              |

---

## 3. What the rewrite actually did — measured

Window: `2026-08-19` → `2026-09-02`, **625 commits** (619 when the diff below was taken), 40 merges, 4,392 files touched.

| Bucket                               | Files |     Added | Deleted |          Net |
| ------------------------------------ | ----: | --------: | ------: | -----------: |
| `src` production                     | 2,046 |   229,469 |  40,992 | **+188,477** |
| `src` tests                          | 1,417 |   226,494 |  12,861 | **+213,633** |
| `src` stories                        |    83 |     6,682 |   2,483 |       +4,199 |
| `docs/release-evidence`              |    44 |   105,764 |   **0** |     +105,764 |
| `scripts`                            |   139 |    26,652 |   1,557 |      +25,095 |
| `drizzle/*.sql` (119 migrations)     |   119 |    17,136 |      40 |      +17,096 |
| `docs/operations`                    |    47 |    10,795 |     197 |      +10,598 |
| `docs` (other)                       |   271 |    26,990 |  34,905 |   **−7,915** |
| `services`                           |    44 |     2,470 |     568 |       +1,902 |
| `e2e`                                |    15 |     1,621 |     129 |       +1,492 |
| `drizzle/meta` (generated snapshots) |    82 | 1,946,487 |      34 |   +1,946,453 |

Derived facts:

- Current `src` is 3,792 files / 716,383 lines (380,495 production + 335,888 test/story). **~49.5% of all production code and ~64% of the test suite is fifteen days old.**
- Repository-wide deletions were **157,234 against 2,610,963 additions (6%)**; excluding generated Drizzle snapshots, **~157k deleted against ~647k added (24%)**. `docs` (other) is the only bucket that genuinely contracted.
- 119 new migrations in 15 days ≈ **8 per day** for a product with one tenant, each regenerating a full schema snapshot — **1.95M lines of generated JSON** committed in the window.
- Commit types: **236 `fix`**, 118 `feat`, 60 `test`, 60 `docs`, 43 `chore`, 38 `refactor`, 9 `ci`, 4 `perf`, 3 `revert`.
- Commit scopes: **259 product-scoped vs 242 machinery-scoped** of 501 classified (**48% machinery**). The single largest scope in the window is `e2e` (40 commits, 21 of them fixes) — the test harness needed more repair than any product area.

Read plainly: the response to "you have built more surface than you wire, activate, test and document" was to build more surface, and to spend half the effort on the apparatus that measures it. The apparatus got better. The measured thing grew faster.

---

## 4. What was achieved — real, verified, keep

Closed pre-rewrite findings, spot-checked by me at source:

| Pre-rewrite                                                               | Fix                                                                                                                        | Evidence                                                                                                                                       |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEC-02` no CSRF in the custom Start instance                             | Installed with `secFetchSite: 'same-origin'`, `allowRequestsWithoutOriginCheck: false`, filtered to server functions       | `src/start.ts:3,27-31,53`                                                                                                                      |
| `AUTH-01`/`SEC-05`/`SEC-06` password change/reset preserve other sessions | Both revoke; proved at the real boundary                                                                                   | `src/shared/auth/auth.ts:89,160`; `src/contexts/identity/server/auth-settings.ts:38`; `src/shared/auth/session-revocation.integration.test.ts` |
| `DATA-01` re-observation cascade-deletes staff replies                    | FK is now `onDelete: 'restrict'`; the delete path is `@deprecated SAFE-03 keeps this compatibility dependency unreachable` | `src/shared/db/schema/review.schema.ts:889`; `src/contexts/review/infrastructure/reply-command-store.ts:1051-1052`                             |
| `DATA-02` `pool.query` retry can double-execute an autocommit write       | Retry is scoped to connection _acquisition_ on transient connection errors only                                            | `src/shared/db/pool.ts:67-73`                                                                                                                  |
| `ARCH-12` `JobRegistry.register` silently overwrites                      | Throws `Job handler "…" is already registered`; registry is container-owned                                                | `src/shared/jobs/registry.ts:22-24`                                                                                                            |
| `ARCH-05` events recorded after the business write                        | Atomic command stores; `emitAndRecord` banned in review/inbox/portal/guest/identity/property/integration/metric            | `src/shared/architecture/atomic-*-outbox.test.ts`                                                                                              |
| `OPS-01` E2E seeder in production bundles                                 | Source-map graph walk rejects seeder, operator commands, local tools; it caught a real regression on 2026-09-02            | `scripts/check-production-artifacts.mjs:23-60`; commit `0910829e`                                                                              |
| `OPS-03` 73 modules outside typecheck                                     | `check:typescript-project-coverage` → "4,162 TypeScript modules are owned by 3 invoked projects"                           | verified run, 199s                                                                                                                             |
| `UI-01` `all` period compares against itself                              | `priorPeriodDates('all', …)` returns `null`, with a test that names the old defect                                         | `src/contexts/dashboard/application/utils.test.ts:94-98`                                                                                       |
| `GOV-02` boundary enforcement accepts known-invalid imports               | Executable fixture matrix: "OK — 24 invalid imports rejected; 14 valid seams accepted"                                     | `scripts/check-architecture-boundary-controls.mjs`                                                                                             |
| `OPS-07` no branch protection                                             | `main` requires `check`, `docker`, `e2e`, `secrets`, `audit`; force-push and deletion disabled; linear history required    | live GitHub API readback                                                                                                                       |
| `OPS-05` `railway up` from a working tree                                 | Promotion accepts only registry `@sha256` references and verifies signature/provenance                                     | `.railway/service-source-map.ts:45-76`                                                                                                         |

Product-side achievements: closed-beta exclusions are executable at server boundaries rather than hidden in the UI (`/register` gated server-side at `src/routes/register.tsx:15-29`, raw `/sign-up/email` refused at `src/routes/api/auth/$.ts:44`); the single-property redirect moved from a client `useEffect` after a blank SSR page into the loader (`src/routes/_authenticated/dashboard.tsx:69-74`); fleet pagination exists; the `/properties/$id/metrics` "coming soon" placeholder and the `/settings/preferences` dead notifications card are deleted; billing and the org switcher are gone from the shell; the `InboxFilters` corpse became a live filter popover; "Edit & Resubmit" is implemented; `ratingTrend`/`reviewVolume` are drawn; the five-way attention breakdown ships on both dashboards with deep links; `ai_property_daily_aggregates` category and sentiment data — 20 columns that previously had zero UI — is surfaced with click-through into a pre-filtered inbox.

Coverage moved from a decorative floor to a real two-arm ratchet. `scripts/check-coverage.mjs:32-93` pins the 2026-08-29 measurement — **overall 59.79% lines / 52.42% branches / 53.66% functions / 58.68% statements** over all of `src/**` (up from ~54% pre-rewrite and +3.3pp on the previous pin), **domain 98.03% lines**, tier-1 exact 100% on glob-discovered pure rule files — and enforces both a floor _and_ a ceiling, so a stale baseline cannot decay silently. The header records that when the 42-package program added a large amount of domain code the domain aggregate _fell_ to 97.34%, the floor arm caught it, and "it was answered with tests, not with a lower floor." That is the correct instinct, documented at the point of enforcement.

---

## 5. What is genuinely good — protect this

These are load-bearing. Do not "simplify" them while right-sizing everything else.

1. **`src/shared/governance/capability-fate.ts` (165 lines).** One readable table: per capability, a fate (`core`/`controlled_beta`/`beta_disabled`/`safety_blocked`/`legacy_blocked`/`permanently_denied`), the authority, and the exact condition for reactivation — including three `permanently_denied` entries with "No activation path exists." This is what every other governance artifact in the repository should look like and does not.
2. **One tenant-isolation mechanism.** `resolveTenantContext` → `requireExecutionAllowed` → `scopeForPermission` → a single `createGrantAccessLookup`. Property scope is derived from the governing permission everywhere; no role-string or literal-boolean scoping survives. 24/25 sampled server functions clean; the deviation (`createOrganizationFn`) is behind a compile-time block. 84 test files carry two-organization fixtures, several with comments stating exactly which dropped conjunct they would catch.
3. **AI egress minimization.** Prohibited content is _not representable_: `reviewSourceSchema` is `.strict()` with exactly `kind, text, rating, languageCode, reviewedAtEpochMillis`; reviewer names are Unicode-case-folded to `[PERSON]` with placeholder-forgery escaping; a canonical digest is `timingSafeEqual`-compared before any provider call; the response requires a matching Ed25519 settlement receipt; DNS, URL, method, and H2 are pinned. Twelve verified hops, `src/shared/ai-review-source-contract.ts:218-256` onward.
4. **The public Guest edge.** `resolveBoundSession` is the single gate, ordered correctly (token → exact `Origin` equality → scope-bound signed cookie → constant-time CSRF → capability decision), with every failure funnelled into one non-enumerating 404, three layers of rate limiting that survive cookie rotation, `private, no-store` applied _inside the validator_, and a honeypot that returns a plausible success view.
5. **The reply publication saga.** Approval atomically commits authorization plus facts before a best-effort enqueue; the job re-checks cycle and revision fences before the provider call; only `review.reply.observed` with an exact-current permit closes the cycle. A crash, duplicate delivery, stale draft, ambiguous provider response, or external Google edit cannot be mistaken for a confirmed publication.
6. **Capability-gated job registration.** `registerCapabilityGatedJob` (`src/bootstrap.ts:162-176`) means dark or blocked work has **no executable handler** — not a disabled UI. This is the correct reading of "a hidden UI is not a gate."
7. **Gates that caught real bugs.** `check:security-headers` boots the actual `.output/server/index.mjs` and asserts the full header set on a 200, a 404 _and_ a 413 — it exists because a nitro-version mismatch once made the header plugin inert in production, which no static check could have found. `check:production-artifacts` walks the source-map graph and caught a real regression days ago.
8. **The CI shard split.** `dc1fc97e` cut the `check` wall from 1,110s to ~372s (−66.5%) for +0.6% runner compute, with no question deferred. The commit message contains the measurement that motivated it. This is the model for the rest of the work.
9. **Honesty in comments.** `src/shared/events/schema-registrations.ts:459-463` documents, in the code, that a past wiring bug meant zero outbox rows ever existed for `metric.recorded` _and_ that the registered schema would have rejected them anyway. `src/contexts/activity/domain/integrity-claims.test.ts:17-21` bans the strings `previousHash` and `tamper-evident chain` from source, enforcing §3.8.4 executably. Keep this culture; it is rarer than the architecture.
10. **The two-arm coverage ratchet** (above) and `scripts/check-test-quality.mjs`, which scans 1,662 test/spec/story files across `src`, `services`, `e2e`, `scripts`, `server`, `.railway` and `.storybook`, rejects focused tests, unregistered skips, generic-error acceptance and unasserted async failures, and fails closed on runtime drift unless explicitly acknowledged. This closes the exact excluded-region pattern that produced false greens before the rewrite.

---

## 6. What needs substantial change — ranked

### S1 · `revision_conflict` is an unhandled production error, papered over in the test harness — HIGH

`revision_conflict` is thrown by ten inbox and portal server paths. No component or route handles it: `grep -rn revision_conflict src/components src/routes` returns one match, a type union in `inbox-bulk-actions.stories.tsx:34`. `InboxDetailManagerActions` submits `expectedCommandRevision: item.commandRevision` from loaded page data with no recovery. The outbox relay bumps `command_revision` every 5s without changing status (`relay.start(5_000)`), so a manager who loads an item and clicks inside that window gets an unhandled page error — measured at **~50% of local runs** and once took `e2e` red on `main` (`aed3cc72`).

The shipped remedy is `waitForInboxItemSettled` (`e2e/helpers/fixtures.ts:200-233`): poll `command_revision` until quiet for one relay tick plus a second, up to 45 seconds, _before_ the test clicks anything.

**Do:** make the mutation path recover — refetch the current revision and retry once, or surface a "this item changed, reload" affordance — then delete the synchronizer. **Cost:** small, one mutation wrapper plus a conflict state. **Risk of not doing it:** the single most likely thing a real beta user will hit, and the suite is specifically arranged not to see it.

### S2 · Production is an exception deployment with no pager and no recovery — HIGH

The plan mandates exactly one `cell-us` in Railway `us-west2` with its bucket in `sjc`, digest-promoted immutable artifacts, backups and PITR enabled, and a rehearsed restore (§3.2.5, `REG-02`, `REG-04`, Gate E). Current reality: only the legacy `reputation-key/google-closed-beta` graph exists; no dedicated production or rehearsal project; twelve live services with mixed source commits and no shared `RELEASE_MANIFEST_SHA256`; `Release Images` has **zero runs**; six migrated root `railway.*.json` files remain dual owners next to `.railway/railway.ts`; no backup, PITR, restore, RPO/RTO, candidate manifest, deployed-journey or canary artifact exists.

Worse, at `2026-09-02T20:54Z` all twelve Railway services reported `SUCCESS` while an authenticated operational read reported **`jobs.ready=false`, one repair-required job, and 19 dead letters**. Neither `SENTRY_DSN` nor `ALERT_WEBHOOK_URL` is configured; the legacy environment bypasses the mandatory-Sentry guard; snapshot degradation has no alert definition at all. And the erasure-ledger resurrection fence reads its ledger _from the database being restored_, so a PITR can roll back both the erased data and the evidence required to erase it again.

**Do, in this order:** one alert that reaches a human; drain and diagnose the 19 dead letters; one dedicated cell with backups and PITR; one isolated restore drill; one immutable promotion. **Cost:** operator time and money, no new code. **Risk of not doing it:** the beta is currently running blind on data it cannot restore.

### S3 · Deployable container isolation is real only in tests — HIGH

`src/composition/deployables.ts` exports `createWebContainer`, `createWorkerContainer`, `createOperatorContainer`, and there are occupancy/projection tests for all three. Only `src/worker/index.ts:120` uses one. `createWebContainer` and `createOperatorContainer` are called **exclusively from `src/shared/testing/process-fixtures/*`**. Every server function, route and operator script calls the raw singleton `getContainer()` and receives all **69 container keys** — including `db`, `pool`, `redis`, `eventBus`, `outboxRepo`, `jobRegistry` and worker runtimes. I counted **283 calls in 68 non-test `src` files plus 28 in 13 `scripts` files (311/81)**.

So the `ARC-03` isolation proof exercises paths production does not take, and `src/composition.ts` is under its pinned 1,000-line budget (991) only because the budget forces slices into siblings — total production composition is **4,215 lines**, and composition is explicitly permitted to import context internals, which it does 58 times at runtime.

**Do:** make `getContainer()` return the web projection, route operator scripts through `createOperatorContainer`, and let the type system enumerate the violations. **Cost:** medium and mechanical; the projections already exist and are tested. **Risk of not doing it:** the isolation claim is decorative, and the budget mechanism is producing file-splitting rather than depth.

### S4 · The flagship manager surface tells the manager false things — HIGH

`/properties/$propertyId` ("Overview") contradicts §3.6 four independent ways:

- **Default period is All Time**, not rolling 30 days versus the preceding 30 (`src/routes/_authenticated/properties/$propertyId/index.tsx:18`; `dashboard.dto.ts:23`). The fleet view is hardcoded `'30d'` with no control at all (`dashboard.tsx:40`).
- **The Avg Rating delta renders as a percentage** — "4.3 ↑ 4.9%" — with no sample floor, against `MET-01.5`'s "absolute stars, never percent, ≥10 ratings both periods" (`dashboard.repository.ts:98-104` → `property-dashboard-helpers.tsx:9-12`). Fleet and Portal do it correctly; the property page does not.
- **Missing data is coerced to zero.** `avg(...)` NULL becomes `0` (`src/contexts/review/infrastructure/serving-stats.ts:103-122`) and flows into value, prior and trend. A property with no eligible Google reviews is told its reputation is `0.0`. §3.6.3 forbids exactly this, and the Metric-backed KPIs on the same page get it right by carrying `null` plus evidence.
- **Four availability vocabularies for one contract:** Portal analytics has the complete `Data through…`/`Updating`/`Insufficient data`/`Temporarily unavailable` set; property KPIs have three states and no `insufficient_data`; fleet renders a raw `fresh|stale|insufficient_data` enum as badge text; Goals uses `ready|updating|insufficient|unavailable`.

**Do:** default to `30d`; make period stats carry `avgRating: number | null` with evidence and suppress the trend unless both periods are non-null; render absolute-star comparison; collapse to the Portal vocabulary behind one `AvailabilityLine`. **Cost:** small-to-medium — one shared DTO/repository contract and cache keys, no storage change. **Risk of not doing it:** the one user of this product is being shown false business facts on a core ON capability.

### S5 · Two live response-timer authorities, and the dashboard reads the wrong one — HIGH

§3.4.9 is explicit: "Google Review **Response Target**, not SLA." Both exist. `/settings/organization` renders `ResponseSlaCard` ("Response SLA … Drives the dashboard attention band") _and_ `ResponseTargetSettingsCard` side by side. Inbox implements the canonical Response Target with `confirmed_on_google` as the only stopping condition (`review-response-target-authority.port.ts`). The Dashboard and Fleet attention signals call `extractResponseSlaHours(org)` (`src/contexts/dashboard/server/dashboard.ts:114`; `fleet-overview.ts:48`) and feed the legacy value into `slaCutoff`.

Consequence: the dashboard's "needs action / unanswered" number and the Inbox's overdue set use a different clock _and_ a different completion rule, so they can disagree — and the settings page invites the operator to tune the wrong one.

**Do:** delete `responseSlaHours` and its two server functions; make Dashboard/Fleet attention read Inbox Response Target facts. **Cost:** medium; one column retirement plus an adapter swap. **Risk of not doing it:** two numbers for the same question, one of which is not the contract.

### S6 · Dead machinery is receiving governance instead of deletion — HIGH

§3.6.6: "Dead rollup tables/jobs with no beta reader are **removed** after fresh reachability proof."

`rollup_daily_metrics`, `rollup_weekly_metrics`, `rollup_daily_inbox_metrics` have exactly one product consumer: none. What they do have is a writer (`incremental-rollup.ts`), three job handlers registered **unconditionally** — not capability-gated, unlike their neighbours (`src/bootstrap.ts:408-418`), three catalogue rows with 5-minute timeouts (`event-job-catalogue.ts:2773,2785,2797`), an inventory report (`ops:report-legacy-rollups`), an offboarding deleter (`metric-organization-lifecycle.adapter.ts:307-313`), and a `data-fate-authority` entry (`:829-832`). Five governance touchpoints, one writer, zero readers, still on a schedule in production. `rollup_daily_inbox_metrics.avgResponseHours` — named in the 2026-08-19 audit as the missing input to response-performance UI — still has no reader.

This generalizes. Of 242 physical tables: 189 active, **6 written with no query reader**, 8 evidence-only, **39 legacy/quarantined**. Of 656 symbols exported from the 17 context barrels, **488 have no named production importer outside their owner**, and Goal/Inbox/Notification/Review still export repositories, stores and queues that `ARC-03` forbids. `team` still carries 26 production files / 3,673 LOC. `CNV-01` remains `in_progress` and total deletions were 15% of additions.

**Do:** unregister the three rollup jobs today (one edit, removes three scheduled writers); then contract them under the existing Lane H rules. Apply the same test to the 6 write-only tables and the 488 unimported exports: if the answer is "kept for export/restore compatibility", say so in one line in `data-fate-authority` and delete the _code_; if there is no answer, delete both. **Cost:** low per item, and it is the only work that makes everything else cheaper. **Adopt the rule:** no new governance artifact may be added to describe machinery that has no product reader — delete the machinery instead.

### S7 · Governance is coupled to the text of what it governs, and it cascades — HIGH

A four-step cascade from one legitimate performance improvement, all inside 46 minutes on 2026-09-02, observed live while this review was running:

1. `dc1fc97e` (23:29) split the serial `check` job into four shards — a measured 66.5% latency win. `src/shared/governance/gate-wiring.test.ts` asserted, by regex-scraping workflow YAML, that a step named `Test` contained both `pnpm check:coverage` and `pnpm test:integration`. The split put them in different jobs → **red**. I measured this failure directly at 23:42.
2. `3f76a99c` (23:50) fixed that test properly — occurrence counts instead of a YAML-shape regex, a written rationale, and an explicit "whoever adds a seventh deliberately updates this number." It also **renamed** the test.
3. `docs/release-evidence/review/pre-fix-oracle-index-2026-08-26.json:861` pins the **literal English test title** `"runs the same coverage ratchet before merge and on main without a second unit run"` as `currentRegressionProofs[0].contains[1]` for oracle `BASELINE_GATE_INTERRUPTION`. The rename → **red again**. I reproduced that three times (267s / 331s / 360s wall), and each time `pnpm check:coverage` aborted before emitting `coverage-summary.json`.
4. `0edbc466` (00:15) resolved it by **renaming the test back** and adding `// DO NOT RENAME. This title is a pinned regression marker… that index is sha256-attested release evidence… which is how I found out.` I verified the two files green at the new HEAD (33/33 in 2.6s).

So the immediate blocker is closed and the coupling is now permanent and documented. That is the finding, not the outage: an English sentence inside a test file is now load-bearing release evidence, and the correct engineering response — occurrence counts that survive a job-graph change — had to be reverted at the title level to keep an attested JSON happy. The next tripwire is already visible in the same file: `expect(occurrences('github.event_name')).toBe(6)`.

The pre-fix oracle mechanism is a _good_ idea — freeze a reproduction of each original high finding so a fix cannot silently regress. Binding it to prose is not. Note also that for the ~46 minutes this cascade was live, the coverage gate could not run at all: the same class of blocker the pre-rewrite review recorded as `GATE-01`.

**Do:** give each oracle a stable proof ID that the test _carries_ (`// @proof BASELINE_GATE_INTERRUPTION`) and match on that, so titles stay editable and the attested index stays immutable. Then audit every gate that asserts the _text_ of another artifact. **Cost:** hours. **Risk of not doing it:** every legitimate refactor of a governed file costs a governance edit, and periodically the coverage gate goes dark while that edit is found.

### S8 · Gate F and `GATE_POLICY` are not a working release authority — HIGH

116 gates are inventoried in a 147KB document while `GATE_POLICY` declares eight, and **no workflow or hook invokes `pnpm gate`**. Gate F bypasses the policy entirely and hard-requires a fixed list of 18 evidence IDs, three of which are structurally impossible for a one-participant beta (blanket distinct-attester, independent-review, and distinct support/incident-owner identity constraints). The `release-signing` GitHub environment it references does not exist. Release preflight binds a SHA and seven CI jobs but omits the required `audit`, CodeQL and simulation. Legal is five drafts and zero approvals. `Release Images` has never run.

Meanwhile the gate ledger classifies the 116 as **55 essential, 43 useful, 5 ceremonial, 5 redundant, 8 harmful** — so ~15% are provably not paying for themselves, and 43 registered standards exceptions are all owned but their expiry is never compared with the current date. Thirty-two of them would disappear by retiring two near-universally-excepted standards (`triple`, `files`), which an 80% exception rate proves are not standards.

**Do:** generate required checks, release prerequisites and the gate ledger from **one** manifest; re-scope Gate F to the cohort that actually exists (this is the honest answer to issues #374/#375 — and the retrigger table in `GATES.md` §"Definitive 116-gate ledger" is ready to apply); delete the 13 ceremonial/redundant rows and fix the 8 harmful ones; make exception expiry time-enforced. **Cost:** a day of consolidation. **Risk of not doing it:** three mutually inconsistent definitions of "green", none of which can currently release.

### S9 · Active documentation contradicts the fixed contract, including the security docs — HIGH for two files, medium overall

The active human-guidance corpus — `docs/**` excluding `archive/` and `release-evidence/`, plus the 22 `src/**/CONTEXT.md` guides, plus 8 root markdown files — is **196 files / 38,728 lines** (`DOCS.md` measures 197/38,749 on a marginally wider definition). Since `f46d2cd6` (2026-08-01) markdown grew by **+24,779 / −2,828 = net +21,951 lines across 240 files**. Nine of 23 root and layer guides are demonstrably inaccurate while the structural documentation gates pass. The two that matter most:

- **`SECURITY-AUDIT-REPORT.md` at the repository root**, dated 2026-05-22, no status/owner/expiry, asserts unfixed P1 tenant and authorization defects, cites **three files that no longer exist**, claims inbox mutations have no permission check (there are 26 `requireExecutionAllowed` call sites across the six real `src/contexts/inbox/server/*.ts` modules; the `inbox.ts` the report cites is now a 33-line re-export barrel), claims `auth-settings.ts` lacks `resolveTenantContext` (it has one at `:26-27`), and recommends `can()`-based fixes that `FND-02` explicitly superseded. It is the first security document anyone finds.
- **`docs/SECURITY_ONBOARDING.md`** — the file the repo tells an operator to read before deploying — states that email verification is hard-disabled and "anyone can register with any email address." Both false: `requireEmailVerification: env.EMAIL_VERIFICATION_REQUIRED` with the variable _required_ in production, and registration is refused at the HTTP boundary _and_ by a compile-time-blocked capability. §7 instructs the operator to uncomment a block that is already live, which would regress the configuration.

Also: `MIGRATION.md` presents `auth:migrate` then `db:migrate` as the complete first-time path while `README.md` correctly requires `db:migrate-deploy` with sidecars — a split brain on database provisioning. `PRODUCT.md` and `DESIGN.md` still describe staff mobile progress, badges and leaderboards as current product, all three of which are `beta_disabled` or `legacy_blocked`. The threat model carries five stale mitigations including one naming a module that returns zero grep matches. `session.ipAddress`/`session.userAgent` are documented with a "security audit" purpose and 30-day retention and have **no reader anywhere in `src`** — write-only PII.

**Do:** delete or archive the root security report with a supersession header; rewrite `SECURITY_ONBOARDING.md` §4.1/§4.2 and delete §7; reconcile `MIGRATION.md` to `README.md`; re-cut `PRODUCT.md`/`DESIGN.md` against §3; extend the existing authority test to reject a root-level markdown security claim that lacks `Status:`/`Date:` or references an absent path — that one rule catches all three dead citations. **Target:** ≤160 active files / ≤28,000 lines, with provenance moved out of the guidance path.

### S10 · Deployed "critical journeys" prove nothing about the product — HIGH

729 lines of release-evidence machinery wrap **six anonymous, read-only probes** that check health, render and refusal. No authenticated business journey runs against a deployed environment. In the local suite, the three core loops are each split at a seed boundary: Google import never continues through reply publication; Portal feedback never continues through manager handling; Metric facts never continue through Goal availability in a browser. So the product's three reasons to exist have strong _component_ evidence and no _end-to-end_ evidence.

**Do:** rename them honestly today, and add one operator-authorized synthetic authenticated journey per loop with cleanup receipts. **Cost:** medium; requires a non-customer Google profile, which the plan already schedules as Lane D.

### S11 · Capability refusal is one generic state for six different causes — MEDIUM-HIGH

Thirteen of 37 capabilities are OFF, and `CapabilitySet` exposes only `allowed: string[]`. Every denial — wrong audience, deliberate beta exclusion, tenant not allowlisted, legal block, missing Google connection, missing AI authorization, service unready — renders the same "Not available in this beta", and `/unavailable`'s "Back to home" sends managers to `/home`, the Staff shell, which has no role guard. This is issue #413, and it converts an accurate backend refusal into support load.

**Do:** return a stable user-facing category plus next action (`not_in_beta`, `needs_admin_enablement`, `needs_google_connection`, `needs_ai_authorization`, `temporarily_unavailable`, `wrong_role`) derived _after_ the authoritative deny, never used to grant. Keep policy internals server-side.

### S12 · The database can persist cross-tenant mismatches, and nothing prevents the next unguarded query — MEDIUM-HIGH

Application predicates are consistent across a 15-table sample, but `reviews`, `replies`, `inbox_items`, base `metric_readings` and `operational_action_history_records` retain **app-only** organization/relationship consistency — no composite tenant FK. And there is no static gate: `src/shared/architecture/` has canaries for tenant-cache ownership, observability, privacy exfiltration and security headers, but none for tenant predicates. The guarantee whose failure ends the beta is currently upheld by 84 tests that someone remembered to write, across 400k+ lines of context code.

**Do:** add one AST-walking architecture test over `contexts/*/infrastructure/repositories/**` requiring an `organizationId` conjunct or membership in an explicit `TENANT_PREDICATE_EXEMPTIONS` map with owner and reason — the exact pattern `db-only-constructs.ts:757-800` already uses. Then run mismatch reports, repair, and add the composite FKs. **Cost:** ~150 lines plus one map. **This is the highest-leverage single addition in the entire review.**

---

## 7. Also material, bounded

- **Import v2 admission is not coupled to its only dispatcher.** `property.import_gbp_v2` is ON for all six properties; item dispatch is exclusively a durable outbox consumer; the dispatcher remains optional and default-off; readiness skips durable-consumer checks when off, and web admission does not depend on dispatcher health. Work can be accepted that nothing will execute.
- **The Inbox `record-only`/`shadow`/`switch` cutover flags do not control durable dispatch.** With the global dispatcher on, both `record-only` and `shadow` run bus _and_ durable consumers; with it off, both are bus-only. Only `switch` changes bus registration. The documented rollback state machine is not implemented.
- **The durable envelope is below the `ARC-01` contract:** no command ID, no aggregate type, nullable causation documented as "null today", optional aggregate version.
- **Retention has two authorities.** A counsel-pending, report-only registry, and 28 static rules that actually execute daily; production passes no registry rules to its guard, and the claimed 24-month class omits separately stored qualified-scan and click facts.
- **Five runtime construction cycles** remain behind late-bound closures and one mutable deferred port, even though static cycles are zero.
- **`migratable.ts` omits 12 application-owned tables**, so drift checking cannot see them; drift CI runs only against a disposable database and never verifies the sole compatibility view.
- **The unit harness costs more in setup than in tests.** Three measured runs: 267–360s wall, of which Vitest setup was 213–333s against 145–290s of actual test execution, driven by 1,302 files each loading `src/test-setup.ts` under a four-fork pool. That is the cheapest large latency win left after the shard split.
- **Component library duplication:** five "big number + small label" KPI card components (an explicit `PRODUCT.md` anti-reference), four star renderers, three time-range controls, two rating-distribution implementations (one hand-rolled `div`s, one on `ChartContainer`), the 44px touch target implemented as 40 per-call overrides across 26 files instead of in `Button`, 25 hardcoded palette classes across 9 files with two failing AA on dark, 28 uppercase eyebrows across 16 files, and dead `Facebook`/`Yelp` platform filters with brand hex colors on the primary journey when the source enum is `['google']`.
- **Still dark after the "surface what you compute" pass:** reply AI provenance (15 columns; every read-only view narrows to `{text, publishedAt, rejectionReason}`), the AI-assisted marker on published replies, `replyAdoptionDisposition` (column with a CHECK, no writer), AI quota and activity UI (`ai_property_quota_windows` enforces 500/100 daily caps invisibly), trend history (32 outcomes fetched, one shown), and Handling Cycles as visible work episodes (`cycleNumber` reaches the client only as a concurrency token).

---

## 8. Proportionality — machinery against the tenant that exists

One organization. Six properties. One web replica, one worker replica. 24 of 37 capabilities ON.

| Machinery                                                        |                                                                                                                                           Size | Judgement                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable outbox, atomic command stores, provider-truth reply saga |                                                                                                                                              — | **Justified.** Failure modes are data loss and false publication. Do not touch.                                                                                                                                                  |
| Tenant isolation + 84 two-org test files                         |                                                                                                                                              — | **Justified — highest value per line in the repository.**                                                                                                                                                                        |
| Four provider sidecars (~84 files, 4 images)                     |                                                                                                                                      ~84 files | **Justified by §1** — real credential/network trust boundaries. Retrofit is near-impossible.                                                                                                                                     |
| `ExecutionPolicy` (758 lines)                                    |                                                                                                                                            758 | **Justified.** Operator branch and AI consent fence are legal-exposure controls, not scale controls.                                                                                                                             |
| Governance catalogues: entry-point (6,348) + event/job (3,044)   |                                                                                                                                **9,392 lines** | **Disproportionate as built.** Hand-maintained; drives real job policy but 443/542 entry points claim only `direct_declaration` — source existence, not execution. Generate the inventory; keep a small semantic policy surface. |
| Composition graph                                                |                                                                                                  **4,215 lines / 69 keys / 311 locator calls** | **Disproportionate.** Split into files, not deepened into capabilities, and two of three deployable projections are unused in production.                                                                                        |
| 116 gates (147KB inventory)                                      |                                                                                                              55 essential / 43 useful / 18 not | **Mostly justified, 13 deletable, 8 harmful.** Keep the questions; fix the topology and the setup cost.                                                                                                                          |
| CI image assurance                                               |                                                                                                          10 builds + 10 SBOMs + 10 scans, 549s | **Justified** — off the critical path, and the prior five-builds/three-scans mismatch is gone.                                                                                                                                   |
| Release/ops command surface                                      | 176 npm scripts, 11 railway configs, 10 Dockerfiles, 11 tsup configs, `scripts/release` 18,384 lines, `scripts/ops` 6,982 lines, 96KB runbooks | **Disproportionate.** Collapse _after_ one real promotion proves which paths are load-bearing.                                                                                                                                   |
| Active documentation                                             |                                                                                        196 files / 38,728 lines (net +21,951 since 2026-08-01) | **Disproportionate.** Target ≤160 / ≤28,000; generate what can be generated.                                                                                                                                                     |
| Migration history                                                |                                                                                  178 migrations, 1.95M lines of generated snapshots in 15 days | **Acceptable only while contraction is real.** It currently is not.                                                                                                                                                              |
| Dormant product estate                                           |                                                  13 OFF = 4 built-and-fenced + 6 partial + 3 id-only; 39 legacy tables; 488 unimported exports | **Disproportionate.** Delete the id-only identifiers and the unneeded complete dormant paths.                                                                                                                                    |

The asymmetry is the point: the machinery that protects _external side effects and private data_ is proportionate even at six properties, because its failure mode is unbounded. The machinery that describes _the repository to itself_ is not, because its failure mode is a red build and a stale document — and that is where the growth went.

---

## 9. Recommended sequence

Nothing here is new architecture. Every item is a deletion, a rewiring, or a proof.

**Today (hours)**

1. Re-run `pnpm check:coverage` under Node 22.23.2 to confirm a number exists again after `0edbc466` — the last three attempts aborted, so the ratchet has been unverified since 2026-08-29.
2. Unregister the three rollup refresh handlers (`src/bootstrap.ts:408-418`) → three scheduled writers of unread tables stop.
3. Configure one alert sink (`ALERT_WEBHOOK_URL` or `SENTRY_DSN`) and drain/diagnose the 19 dead letters.

**Week 1 — make the product tell the truth** 4. Handle `revision_conflict` in the mutation path; delete `waitForInboxItemSettled`. 5. Dashboard: default `30d`; `avgRating: number | null` with evidence; absolute-star comparison; one availability vocabulary. 6. Delete `responseSlaHours`; Dashboard attention reads Inbox Response Target facts. 7. Refusal categories with a next action; fix `/unavailable → /home` for managers. 8. Delete `SECURITY-AUDIT-REPORT.md`; fix `SECURITY_ONBOARDING.md`; reconcile `MIGRATION.md`.

**Week 2 — delete instead of describing** 9. Tenant-predicate architecture canary with an owner/reason exemption map (§S12). 10. Contract the 6 write-only tables, the 488 unimported exports, `team` source, and the 3 id-only capability identifiers. Record each decision in one line, not one document. 11. Replace prose gate markers with stable proof IDs; retire the 13 ceremonial/redundant gates and the two standards with an 80% exception rate; make expiry time-enforced. 12. Make `getContainer()` return the web projection; route operator scripts through `createOperatorContainer`.

**Then — earn the release, once** 13. One dedicated cell; backups + PITR; one isolated restore drill; one immutable promotion; one authenticated deployed journey per core loop; one canary window. Only after that, re-scope Gate F to the cohort that exists and answer #374/#375 with the retrigger table already drafted.

**Standing rule.** No new governance artifact may be added to describe machinery that has no product reader. If a mechanism needs a catalogue row, an ops report, a fate entry and a lifecycle deleter to stay explicable, delete the mechanism.

---

## 10. Verification log — what I ran and observed myself

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                            | **PASS**, 199s; `check:typescript-project-coverage` → 4,162 modules owned by 3 projects                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm test:unit`                            | 1,302 files / 12,712 tests / 147 skipped, 331s — 2 failures: stale `gate-wiring.test.ts` (fixed by the user in `3f76a99c` eight minutes later) and `pinned-runtime.test.ts` (host Node 26 vs pinned 22.23.2)                                                                                                                                                                                                                                                                         |
| `pinned-runtime.test.ts` under Node 22.23.2 | **PASS** (10/10) — the suite is green under the pin                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm check:coverage`                       | **FAILED** at `scripts/review/pre-fix-oracles.test.ts` on three attempts (331s / 360s / 267s), including one with an explicit `--coverage.reportsDirectory`; no `coverage-summary.json` was ever emitted. Resolved by the user in `0edbc466` at 00:15 by renaming the test back. I did not re-run the full coverage gate after that commit, so **the current number is still the 2026-08-29 pin** in `scripts/check-coverage.mjs:32-93` — overall 59.79% lines, domain 98.03% lines. |
| Oracle coupling                             | `pre-fix-oracle-index-2026-08-26.json:861` pins a literal test title as `currentRegressionProofs[0].contains[1]`; `gate-wiring.test.ts:81-88` now carries a `// DO NOT RENAME.` comment because of it. Both files green at `0edbc466` (33/33, 2.6s).                                                                                                                                                                                                                                 |
| `getContainer()` census                     | 283 calls / 68 non-test `src` files + 28 / 13 `scripts` files; `createWebContainer` and `createOperatorContainer` referenced only from `src/shared/testing/process-fixtures/*`                                                                                                                                                                                                                                                                                                       |
| Container surface                           | 69 top-level keys returned by `createContainer` (`src/composition.ts:730`)                                                                                                                                                                                                                                                                                                                                                                                                           |
| Rollup readers                              | Writer + inventory + lifecycle deleter + fate entry + 3 unconditional job registrations; **zero product readers**                                                                                                                                                                                                                                                                                                                                                                    |
| SLA vs Target                               | `dashboard.ts:114` and `fleet-overview.ts:48` read `extractResponseSlaHours`; Inbox owns `review-response-target-authority.port.ts`                                                                                                                                                                                                                                                                                                                                                  |
| `revision_conflict`                         | 10 server producers; UI matches only in a `.stories.tsx` type union                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Production artifacts                        | `dist-worker/index.js` (6.35MB) contains no seeder code — only `entry-point-catalogue` metadata strings; `.output/server/index.mjs` clean                                                                                                                                                                                                                                                                                                                                            |
| Commit `0910829e`                           | A genuine `check:production-artifacts` catch: a `tsup` entry bundling `scripts/ops/` was rejected and reverted                                                                                                                                                                                                                                                                                                                                                                       |
| Rewrite diff                                | 619 commits at measurement time (625 now); `src` production +229,469/−40,992; `src` tests +226,494/−12,861; `docs/release-evidence` +105,764/−0                                                                                                                                                                                                                                                                                                                                      |
| Program ledger                              | 36/42 implementation, 0/42 repository verification, 0 external; baseline `d377da03` is 161 commits behind HEAD                                                                                                                                                                                                                                                                                                                                                                       |
| Worktree                                    | Clean except untracked `AGENTS.md`, `docs/agents/domain.md`, `docs/agents/triage-labels.md` — note the root `AGENTS.md` is **untracked**                                                                                                                                                                                                                                                                                                                                             |
| `session.ipAddress` / `userAgent`           | No reader in `src`; schema definitions only → write-only PII against a documented 30-day "security audit" purpose                                                                                                                                                                                                                                                                                                                                                                    |

---

## 11. Unverified — needs a runtime or platform check

Ordered by consequence. Each is a specific command or observation, not a research task.

1. **Deployed bytes.** Compare every live service's image digest to one SHA. Current source is **15 commits** beyond the recorded capability-approval binding `5fafeae9` (`git rev-list --count 5fafeae9..HEAD`); nothing in the repository proves what is running.
2. **The 19 dead letters and `jobs.ready=false`** observed at `2026-09-02T20:54Z` — what jobs, since when, and whether user work was lost.
3. **Live Google intake and publication.** On an authorized non-customer profile: publish and edit one review; retain Pub/Sub receipt → targeted fetch → stable Review id → material revision → Inbox cycle → Confirm & Publish → readback → `confirmed_on_google` → cycle closure. This is the one journey no artifact currently proves.
4. **A published Portal token for this tenant**, then one anonymous rating + threshold-eligible feedback + Google selection, ending in manager "Mark as handled".
5. **`TRUSTED_PROXY_MODE`** — if the Railway edge contract is not satisfied, `clientIpFromHeaders` returns `'unknown'` for every request and all guest network-pressure buckets collapse to one global budget per Portal.
6. **`resolveBoundSession`'s `expectedOrigin`** versus the deployed custom domain — a mismatch denies _every_ guest mutation (fail-closed outage, launch-blocking).
7. **Rollup row counts and freshness** before dropping them; **retention/AI-erasure backlog**; **write-only table volumes**; **cross-tenant mismatch reports** before adding composite FKs.
8. **Clean-database provisioning** `0000 → 0177` — the latest retained evidence stops at 130 entries.
9. **Coverage under pinned Node 22.23.2** once the oracle marker is fixed. The pre-rewrite figure was ~54% lines.
10. **Pino redaction at emission** — the threat model's "module exists" is a declaration, not a test.

---

## 12. Axis reports

| File                       | Lines | Scope                                                                              |
| -------------------------- | ----: | ---------------------------------------------------------------------------------- |
| [`ARCH.md`](ARCH.md)       |   284 | Composition, process boundaries, durable facts, catalogues                         |
| [`CTX.md`](CTX.md)         |   318 | Seventeen contexts, public interfaces, duplication, legacy quarantine              |
| [`PRODUCT.md`](PRODUCT.md) |   246 | 37-capability × journey matrix, three traced core loops, §3 violations             |
| [`UIUX.md`](UIUX.md)       |   244 | 2026-08-19 proposal row-by-row, dark data, token/primitive census                  |
| [`DATA.md`](DATA.md)       |   331 | 242 tables classified, migration hygiene, tenant binding, retention                |
| [`TEST.md`](TEST.md)       |   288 | Per-tier census, sampled value audit, core-loop coverage, deletions                |
| [`GATES.md`](GATES.md)     |   394 | 116-gate ledger with classification and retrigger table, exceptions                |
| [`SEC.md`](SEC.md)         |   404 | 25-function isolation sample, traced AI egress, public-edge table, claims register |
| [`OPS.md`](OPS.md)         |   226 | Live topology, release plane, recovery, observability, local loop                  |
| [`DOCS.md`](DOCS.md)       |   260 | Estate measurement, per-guide accuracy, ADR health, ledger spot-check              |

Each report carries its own Verdict, Scorecard, four-bucket findings with `path:line` evidence, proportionality ledger, unverified list, and a clearly separated Opinion section. Where two reports reach the same conclusion from different evidence — the dual response-timer authority, the rollup subsystem, the catalogue-versus-reachability gap — treat the agreement as corroboration, not duplication.

---

## 13. The one-sentence answer

Keep the durable outbox, the single isolation mechanism, the AI egress fence, the guest edge, the publication saga, `capability-fate.ts`, and the shard split; stop adding surface; spend the next two weeks deleting machinery that has no reader, making the dashboard and the inbox tell the truth, and earning exactly one deployed release with a restore drill and an alert that reaches a human — because the product now has less proof behind it than the apparatus that measures the product.
