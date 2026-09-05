# Documentation, evidence, and ledgers — state of the app, 2026-09-02

## Verdict

The rewrite did not eliminate its defining documentation risk: narrow governance tests are green while current authority documents still contradict the fixed product, authorization, durability, composition, route, and migration contracts. It did establish a real precedence rule, an immutable frozen baseline, a complete ADR file index, an AI guide, and substantially more honest dark/deferred context guides. The active program ledger correctly reports zero formally closed packages, but several `implementation: complete` narratives contain stale counts, nonexistent evidence paths, or conclusions disproved by current source. The highest-consequence split is that the approved beta contract defers Staff login/dashboard and competitive recognition while `PRODUCT.md` and `DESIGN.md` still define them as active product audiences. A second root-level split can produce an incomplete database: `README.md` names the deploy wrapper and sidecars, while `MIGRATION.md` still tells operators that two direct commands are the complete deployment order. Current human documentation is also disproportionate for one tenant and six properties: 197 active Markdown/context files and 38,749 lines even after excluding archive and release evidence. The honest axis verdict is therefore **SUBSTANTIAL**: preserve the evidence discipline and the best context guides, but replace hand-copied authority with generated cross-document assertions and contract the active prose surface.

## Scorecard

| Planned outcome (cite the package/§)                                                                                                                                                                                                   | Current reality                                                                                                                                                                                                                                   | Verdict     | Severity |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- |
| Immutable, reconciled baseline and finding register (FND-01, `docs/comprehensive-beta-implementation-program-2026-08-25.md:224-239`)                                                                                                   | SHA-keyed manifest, inventories, logs, and explicit baseline gaps exist (`docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/README.md:1-40`).                                                                                 | ACHIEVED    | —        |
| One authority chain; all contexts and ADRs agree; no phantom references (FND-02, `docs/comprehensive-beta-implementation-program-2026-08-25.md:241-264`; §3.8.1 at `docs/comprehensive-beta-implementation-program-2026-08-25.md:118`) | Precedence and exhaustive indexing exist, but current guides retain obsolete `can()` and old Inbox/product terms; active ADRs point to moved/missing files.                                                                                       | SUBSTANTIAL | high     |
| Runtime catalogue cannot be mistaken for reachability (FND-03, `docs/comprehensive-beta-implementation-program-2026-08-25.md:266-284`)                                                                                                 | Executable catalogue is reachable, but the status row simultaneously says 463 and 537 while current import returns 542; candidate verification remains open (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:81-107`). | IMPROVE     | medium   |
| Stack, migration, error, queue, and executable configuration documentation agree (GOV-01, `docs/comprehensive-beta-implementation-program-2026-08-25.md:1121-1138`)                                                                    | Runtime authority is well separated, but root migration instructions omit the deploy wrapper, registered sidecars, and provider-subject initialization (`README.md:21-27`; `MIGRATION.md:3-21,58-60`).                                            | IMPROVE     | high     |
| Reconciled maps, glossary, ADR status, routes, migrations, and no contradictory current guide (GOV-02, `docs/comprehensive-beta-implementation-program-2026-08-25.md:1140-1155`)                                                       | The ledger declares implementation complete, yet root/layer guides, route map, ADR status, migration counts, and product terms demonstrably disagree.                                                                                             | SUBSTANTIAL | high     |
| Smaller single-source model and zero stale references (CNV-01, `docs/comprehensive-beta-implementation-program-2026-08-25.md:1157-1182`)                                                                                               | Ledger honestly says no physical contraction, but three of its own code-evidence references no longer exist (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:1661-1688`).                                              | IMPROVE     | medium   |
| Fixed invitation-only manager beta; Staff User/dashboard deferred; Badge/competitive Leaderboard dark (§3.1.2/§3.6.5, `docs/comprehensive-beta-implementation-program-2026-08-25.md:45-50,98-105`)                                     | `PRODUCT.md` and `DESIGN.md` still make mobile Staff progress, badges, leaderboards, and motivation part of the current product (`PRODUCT.md:9-17,41-42`; `DESIGN.md:112-128`).                                                                   | SUBSTANTIAL | high     |
| Package closure only when behavior, operations, docs, and evidence agree (§2/§4, `docs/comprehensive-beta-implementation-program-2026-08-25.md:37,126-154`)                                                                            | Validator reports 36 implementation-complete, all 42 repository-verification-open, and zero formal closures; that separation is honest, but implementation claims are not semantically validated.                                                 | GOOD        | —        |

## What was achieved

### DOC-A01 The frozen baseline is real and bounded

**Verdict:** ACHIEVED.

**Evidence.** FND-01 requires immutable SHA/environment evidence rather than copied claims (`docs/comprehensive-beta-implementation-program-2026-08-25.md:224-239`). The evidence README pins the SHA/runtime and inventories, records 12 baseline passes, one failure and five skips, and explicitly carries governance gaps (`docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/README.md:1-40`). The status row retains the exact frozen directory and finding fragments rather than claiming repository closure (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:7-40`).

**Why it matters.** This is the prerequisite that lets later claims be compared with a known tree instead of stale line numbers; it directly addresses the pre-rewrite report's instruction to freeze the final SHA (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:819-832`).

**Recommendation.** Keep the evidence directory immutable. Generate a clearly separate current-candidate delta rather than revising the frozen snapshot.

**Cost/risk of the fix.** No fix is required. The risk is only governance misuse: treating the baseline as current-candidate proof.

### DOC-A02 Precedence, ADR navigation, and the 17-context root map now exist

**Verdict:** ACHIEVED.

**Evidence.** The program defines an explicit precedence chain (`docs/comprehensive-beta-implementation-program-2026-08-25.md:116-124`), and `docs/standards.md:7-25` records subordinate status and exception requirements. Root guidance now says seventeen contexts and lists all seventeen, including AI (`CONTEXT.md:5-8,30-50`). The ADR index links every issued decision, explains number gaps, and records clause-level disposition (`docs/adr/README.md:1-67`); focused execution confirmed its file-completeness check passes (`pnpm vitest run src/shared/governance/adr-index.test.ts src/shared/governance/context-standards-matrix.test.ts` → 2 files, 14 tests passed, 1.57 s; Node 26 engine warning noted).

**Why it matters.** Before the rewrite, the repository had no precedence rule, root/context counts disagreed, AI had no guide, and ADR navigation stopped short (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:492-515,568-587`). Those structural gaps are closed.

**Recommendation.** Preserve one exhaustive index, but generate its status/disposition checks from ADR metadata and test semantic agreement, not merely link completeness.

**Cost/risk of the fix.** Low incremental risk because the current index remains the human navigation surface; generation must preserve clause-level supersession notes.

### DOC-A03 Dark and deferred context posture is markedly more honest

**Verdict:** ACHIEVED.

**Evidence.** AI explicitly says code presence is not activation and separates local implementation from deployed proof (`src/contexts/ai/CONTEXT.md:20-31,259-293`). Badge and Leaderboard explicitly deny runtime/product activation (`src/contexts/badge/CONTEXT.md:5-17,93-108`; `src/contexts/leaderboard/CONTEXT.md:5-25,52-61`). Team describes quarantine and deletion gates rather than a beta feature (`src/contexts/team/CONTEXT.md:5-28,113-127`), Staff distinguishes canonical participation from retained assignments (`src/contexts/staff/CONTEXT.md:5-12,90-118`), and Activity rejects cryptographic/immutable claims while enumerating uncovered families (`src/contexts/activity/CONTEXT.md:7-16,158-203`).

**Why it matters.** These directly repair the pre-rewrite pattern of describing legacy Goal/Badge/Leaderboard jobs and models as active and overstating Activity integrity (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:568-590`). They are useful safety documentation, not marketing prose.

**Recommendation.** Keep their explicit “does not mean active” language and move migration history to a clearly subordinate section or dated evidence artifact.

**Cost/risk of the fix.** Low; careless shortening could remove important denial and deletion preconditions, so retain those while trimming narrative history.

### DOC-A04 Formal closure remains visibly open

**Verdict:** ACHIEVED.

**Evidence.** Running `pnpm review:validate-program-status` returned 42 packages, implementation `36 complete / 6 in_progress`, repository verification `42 in_progress / 0 passed`, external `8 not_required / 8 not_started / 26 blocked`, and formal closure `0 complete / 42 open` (1.60 s; Node 26 engine warning). The completion plan says physical contraction and full package closure remain open (`docs/program-completion-plan-2026-08-29.md:160-170,193-203`).

**Why it matters.** Local implementation is not being presented as release closure. That distinction is load-bearing given the plan's requirement for deployed, provider, restore, and human evidence.

**Recommendation.** Retain the three axes and zero-closure headline; add semantic freshness validation to the implementation axis.

**Cost/risk of the fix.** Low schema risk, medium migration risk for existing rows if evidence fields become structured rather than free-form strings.

## What is genuinely good

### DOC-G01 Release evidence distinguishes immutable fact from interpretation

**Verdict:** GOOD.

**Evidence.** The frozen evidence README records both successes and failures (`docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/README.md:15-38`). Package rows keep repository and external verification open even when local implementation is complete (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:13-27,50-59`). The execution pack explicitly says unit tests are not runtime registration, provider outcome, or restored-data proof (`docs/operations/external-verification-execution-pack.md:7-32`).

**Why it matters.** This is the best direct response to the former principal risk: declarations masquerading as runtime fact (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:50-67`). The evidence model is worth protecting.

**Recommendation.** Keep immutable raw artifacts and the local/repository/external separation; make every summarized claim derive from artifact metadata or an executable current-tree assertion.

**Cost/risk of the fix.** Medium: changing evidence schemas can invalidate consumers. Version the schema and retain old readers rather than rewriting frozen evidence.

### DOC-G02 The best context guides state boundaries and residual risk precisely

**Verdict:** GOOD.

**Evidence.** Integration names provider route, credential, cell, and no-direct-socket constraints (`src/contexts/integration/CONTEXT.md:17-51`). Review explains worker registration ownership and provider ambiguity/reconciliation paths (`src/contexts/review/CONTEXT.md:205-214`). Metric openly states that its materialized/rollup subsystem has no production reader and remains deletion work (`src/contexts/metric/CONTEXT.md:165-171`). AI and Activity similarly distinguish implemented local controls from unavailable release proof (`src/contexts/ai/CONTEXT.md:259-293`; `src/contexts/activity/CONTEXT.md:158-203`).

**Why it matters.** These guides prevent a maintainer from treating source presence as product reachability and expose the exact remaining contract. That is genuinely load-bearing in a large modular monolith.

**Recommendation.** Use these four as the template: owner, prohibited inferences, active entry path, residual gap, and evidence authority. Do not copy their long migration histories into every guide.

**Cost/risk of the fix.** Low if edits preserve denial language and source ownership; high if a simplification erases residual-risk statements.

### DOC-G03 Narrow governance checks are useful when described narrowly

**Verdict:** GOOD.

**Evidence.** Matrix evidence pointers must resolve and optional content markers must match (`src/shared/governance/context-standards-matrix.test.ts:40-53`). It checks exact 17×11 shape and conservative disposition totals (`src/shared/governance/context-standards-matrix.test.ts:77-98`), required headings and event tables (`src/shared/governance/context-standards-matrix.test.ts:177-239`), while the ADR test guarantees every issued ADR is indexed once (`src/shared/governance/adr-index.test.ts:10-34`).

**Why it matters.** These tests catch missing files, dropped context rows, malformed tables, and unindexed ADRs cheaply. The problem is their advertised breadth, not the checks themselves.

**Recommendation.** Keep them as structural gates and rename/report them as structural. Add separate semantic assertions for the fixed contract rather than inflating these tests.

**Cost/risk of the fix.** Low code risk. The organizational risk is that dashboards may temporarily show fewer “covered” dimensions when honest labels replace broad ones.

## What should be improved

### DOC-I01 The per-document accuracy register has nine incorrect guides and one mixed guide

**Verdict:** IMPROVE. **Severity:** medium.

**Evidence.** This is a static current-tree cross-check, not a runtime certification. “Sampled current” means the key posture, ownership, and named active/dark path agreed with inspected source; it does not assert every sentence is correct.

| Required guide              | Current accuracy                              | Evidence                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTEXT.md`                | **Incorrect**                                 | Seventeen-context map is fixed (`CONTEXT.md:5-8,30-50`), but Inbox still uses `new/read/addressed/escalated/archived`, “Response SLA,” and ADR 0004 (`CONTEXT.md:126-142`); it prescribes `can()`/`assertBetaCapability` (`CONTEXT.md:144-161`) and names two absent test-harness paths (`CONTEXT.md:235-260`).                                                           |
| `src/components/CONTEXT.md` | **Incorrect**                                 | Says `forms/` exists and max 150 lines (`src/components/CONTEXT.md:5-35`); current ESLint explicitly enforces 200, not 150 (`eslint.config.js:1671-1675`).                                                                                                                                                                                                                |
| `src/contexts/CONTEXT.md`   | **Incorrect**                                 | Table lists 14 of 17 (`src/contexts/CONTEXT.md:7-24`), permits composition access to `internal` (`src/contexts/CONTEXT.md:117-147`) contrary to `docs/standards.md:194-225`, and makes role `can()` primary authorization (`src/contexts/CONTEXT.md:149-163,252-256`).                                                                                                    |
| `src/routes/CONTEXT.md`     | **Incorrect**                                 | Maps `properties/import`, slug-pair Portal and old click/QR routes (`src/routes/CONTEXT.md:9-50`); current entry paths are `src/routes/_authenticated/properties/import-google/index.tsx:1-23`, `src/routes/p/$token.tsx:1-30`, and `src/routes/api/public/p/$token/click/$linkId.ts:1-38`. It also prescribes obsolete `can()` guards (`src/routes/CONTEXT.md:153-164`). |
| `src/shared/CONTEXT.md`     | **Incorrect**                                 | Ownership table is strong (`src/shared/CONTEXT.md:5-45`), but “all 47” `headersFromContext` callers and `can()` server guards are stale (`src/shared/CONTEXT.md:138-163`); current-tree static count found 173 awaited calls across 57 production files.                                                                                                                  |
| `src/shared/db/CONTEXT.md`  | **Incorrect**                                 | Claims journal 0140/141 entries and 195/203 tables (`src/shared/db/CONTEXT.md:5-20,103-113`); journal now ends at idx 177 (`drizzle/meta/_journal.json:1237-1250`) and current data-fate import returns 242 models.                                                                                                                                                       |
| Activity                    | **Sampled current**                           | Separates Recent Activity from restricted history and refuses crypto claims (`src/contexts/activity/CONTEXT.md:7-16,158-203`).                                                                                                                                                                                                                                            |
| AI                          | **Sampled current**                           | Capability darkness and deployment-evidence caveats are explicit (`src/contexts/ai/CONTEXT.md:20-31,259-293`).                                                                                                                                                                                                                                                            |
| Badge                       | **Sampled current**                           | Legacy decoder/inventory only, no beta producer (`src/contexts/badge/CONTEXT.md:5-17,31-46,93-108`).                                                                                                                                                                                                                                                                      |
| Dashboard                   | **Sampled current**                           | Read aggregation, bounded milestone write, and availability vocabulary align with the fixed reporting contract (`src/contexts/dashboard/CONTEXT.md:3-24`).                                                                                                                                                                                                                |
| Goal                        | **Mixed but candid**                          | Canonical inventory says old handlers do not run (`src/contexts/goal/CONTEXT.md:15-24,88-91`), but active glossary/use-case/architecture sections still devote large space to legacy models and UI (`src/contexts/goal/CONTEXT.md:59-62,147-182,258-313,339-356`).                                                                                                        |
| Guest                       | **Sampled current**                           | Rating-first, anti-discouragement, qualified-scan, privacy, and lifecycle constraints are explicit (`src/contexts/guest/CONTEXT.md:21-50,220-241`).                                                                                                                                                                                                                       |
| Identity                    | **Incorrect**                                 | Says the other 16 export contributors are unbound (`src/contexts/identity/CONTEXT.md:54-58`), while default composition builds and injects all 16 (`src/composition/organization-export-contributors.ts:55-108`); destructive lifecycle remains deliberately unbound (`src/composition/organization-export-contributors.ts:111-123`).                                     |
| Inbox                       | **Incorrect**                                 | Canonical `open / closed` appears at `src/contexts/inbox/CONTEXT.md:9-26`, but it points readers to superseded ADR 0004 (`src/contexts/inbox/CONTEXT.md:38-45`) and later describes a `read` status badge (`src/contexts/inbox/CONTEXT.md:295-308`) that the DTO test rejects (`src/contexts/inbox/server/inbox-server.test.ts:148-163`).                                 |
| Integration                 | **Sampled current**                           | Provider route, credentials, authority generation, and no-fallback rules are precise (`src/contexts/integration/CONTEXT.md:17-81`).                                                                                                                                                                                                                                       |
| Leaderboard                 | **Sampled current**                           | Explicitly dark, inventory/export only, and names denial tests (`src/contexts/leaderboard/CONTEXT.md:5-25,52-61,115-127`).                                                                                                                                                                                                                                                |
| Metric                      | **Sampled current; records an open plan gap** | Correctly says no HTTP surface and admits zero-reader rollup machinery (`src/contexts/metric/CONTEXT.md:157-171`).                                                                                                                                                                                                                                                        |
| Notification                | **Sampled current**                           | Separates notification/inbox state and enumerates scoped cross-context sources (`src/contexts/notification/CONTEXT.md:9-38,50-59`).                                                                                                                                                                                                                                       |
| Portal                      | **Incorrect**                                 | Claims Goal subscribes to Portal/Group deletion and calls a retained subscriber (`src/contexts/portal/CONTEXT.md:43-46,140-153`); current Goal build explicitly excludes legacy handlers and registers only metric-correction consumption (`src/contexts/goal/build.ts:1-6,105-118`).                                                                                     |
| Property                    | **Sampled current**                           | Current ownership/lifecycle and Google-binding posture are stated in `src/contexts/property/CONTEXT.md:3-60,170-188`.                                                                                                                                                                                                                                                     |
| Review                      | **Sampled current**                           | Stable identity, fact surface, and actual worker-registration contribution are documented (`src/contexts/review/CONTEXT.md:1-93,205-214`).                                                                                                                                                                                                                                |
| Staff                       | **Sampled current**                           | Canonical participation is separated from quarantined assignments (`src/contexts/staff/CONTEXT.md:5-12,90-118,141-163`).                                                                                                                                                                                                                                                  |
| Team                        | **Sampled current**                           | Quarantine, no runtime surface, and contraction gates are explicit (`src/contexts/team/CONTEXT.md:5-28,46-68,113-142`).                                                                                                                                                                                                                                                   |

**Why it matters.** FND-02's definition of done says root and all seventeen contexts must agree on active contexts, errors, events, permissions and capability fates, with no phantom references (`docs/comprehensive-beta-implementation-program-2026-08-25.md:241-264`). A maintainer receives different instructions based only on which required guide they open.

**Recommendation.** Correct the six inaccurate guides first; strip Goal's legacy tutorial sections into archived migration evidence; add generated assertions for context count, route inventory, migration head/model count, forbidden terminology, and referenced paths. Treat “sampled current” rows as review candidates, not proven complete.

**Cost/risk of the fix.** Medium. Most changes are bounded prose/generator work; authorization and lifecycle wording require owner review because deleting a caveat can be worse than leaving duplication.

### DOC-I02 ADR navigation is exhaustive but not faithful enough to decision state

**Verdict:** IMPROVE. **Severity:** medium.

**Evidence.** The index says statuses come from each ADR (`docs/adr/README.md:8-11`) but labels 0059 “Proposed; duration OPEN” (`docs/adr/README.md:62`), while ADR 0059 is `status: accepted` and records the 24-hour owner ratification (`docs/adr/0059-rel-01-canary-observation-window.md:1-4,71-92`). ADR 0019 still freezes `shared/testing/simulation-container.ts` (`docs/adr/0019-simulation-harness.md:36-57`), but current implementation is `src/shared/testing/simulation-container.server.ts:1-12`. ADR 0050 freezes two moved paths (`docs/adr/0050-google-import-and-live-performance.md:46-53`); current contracts live at `src/contexts/property/domain/google-binding-contract.ts:1-15` and `src/shared/google-performance-report-contract.ts:1-15`. A path-existence check returned `False` for both root-documented `src/shared/testing/simulation-container.ts` and `src/shared/testing/scenario/builder.ts`. The ADR test checks link/file equality and accepted frontmatter only for 0054–0058, not index disposition or source references (`src/shared/governance/adr-index.test.ts:10-34`). A static explicit-ID scan found 23/49 ADRs referenced from tests, 13 production-only, and 13 with no explicit implementation/test ID reference; this is traceability, not proof of non-enforcement.

**Why it matters.** An exhaustive table creates stronger confidence than a partial table; stale status and frozen paths therefore undermine the very navigation authority FND-02 introduced.

**Recommendation.** Generate status/date from frontmatter; model disposition/supersession as checked metadata; validate backticked `src/`, `scripts/`, `security/`, and `docs/` references, with an explicit allowlist for historical paths. Amend 0019 and 0050 rather than silently moving their decisions.

**Cost/risk of the fix.** Medium. Historical ADR text must remain provenance, so automation needs explicit “historical path” annotations rather than rewriting old facts indiscriminately.

### DOC-I03 The program ledger is structurally valid but semantically stale

**Verdict:** IMPROVE. **Severity:** medium.

**Evidence.** Five-package spot-check:

| Package | Ledger declaration                                                                                                                                                    | Current source/reachability check                                                                                                                                                                                                                   | Assessment                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| FND-01  | Local implementation complete; repository/external open (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:7-40`)                            | Frozen evidence directory resolves; validator is package-reachable as `review:validate-program-status` (`package.json:101-103`).                                                                                                                    | **Supported locally**, not formally closed.             |
| FND-02  | Authority implementation complete; current rerun says 242 models/537 entry points (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:44-78`) | Docs disagree as DOC-I01; evidence names nonexistent `src/shared/governance/context-acceptance-matrix.test.ts` (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:74`; actual matrix is under `src/shared/architecture/`). | **Unsupported complete claim**.                         |
| FND-03  | Summary/test evidence says 463; external work says 537 (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:81-107`)                           | Current import command `pnpm exec tsx -e "import { ENTRY_POINT_CATALOGUE } ..."` returned **542**. Catalogue source and focused tests are reachable, but the row is not a current snapshot.                                                         | **Mechanism supported; narrative stale**.               |
| GOV-02  | 17×11 totals 122 evidenced/41 exceptions and no contradictory guide (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:1620-1657`)           | Current test expects 120/43 (`src/shared/governance/context-standards-matrix.test.ts:92-98`), while DOC-I01 proves contradictions.                                                                                                                  | **Unsupported complete claim**.                         |
| CNV-01  | Explicitly in progress; no physical contraction (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:1661-1678`)                               | Honest status, but evidence points to missing `src/shared/jobs/runtime.ts`, `src/shared/projections/projection-contract.ts`, and `REUI.md` (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:1680-1688`).                 | **Supported incomplete status; invalid evidence list**. |

The validator parses field shape, package ordering and axis transitions, but never resolves evidence paths, digests claims, or compares counts (`scripts/review/comprehensive-program-status.ts:52-72,80-128,182-201`). It therefore passes the current ledger and prints zero closure even when individual implementation summaries are stale.

**Why it matters.** The ledger is the program's declared completion authority. Free-form evidence strings make it possible for a valid row to cite no file or a moved file, recreating the pre-rewrite “governance artifact reports intended state” failure.

**Recommendation.** Split `codeEvidence` into typed `{path, digest?, assertionId?, observedAt}` entries; resolve current-tree paths; derive counts from the same executable exporters; prohibit numeric claims in prose unless bound to generated fields. Keep historical observations versioned rather than overwriting them.

**Cost/risk of the fix.** Medium-to-high schema migration cost across 42 rows and evidence tooling. The payoff is bounded: it turns existing evidence into verifiable joins rather than adding another catalogue.

### DOC-I04 Superseded and dated material is still reachable as current instruction

**Verdict:** IMPROVE. **Severity:** low.

**Evidence.** GOV-02 requires old plans to be cleanly archived and never linked as current without warning (`docs/comprehensive-beta-implementation-program-2026-08-25.md:1140-1155`). The 2026-08-29 plan supersedes the 2026-08-28 plan (`docs/program-completion-plan-2026-08-29.md:3-6`), but the current progress report still links the 8/28 plan as “Plan” (`docs/release-evidence/review/comprehensive-progress-report-2026-08-29.md:1-7`) and the active external execution pack names it as its companion (`docs/operations/external-verification-execution-pack.md:1-6`). Root `SECURITY-AUDIT-REPORT.md` is an unmarked May audit over 10 contexts/14 server-function files and recommends obsolete `can()` checks (`SECURITY-AUDIT-REPORT.md:1-5,121-153,225-233`). `docs/deep-review.md` is still a current-looking prompt suite; it requires a single `composition.ts` wiring root and ends auth review with `can()` (`docs/deep-review.md:55-80,453-483`), and the GOV-02 ledger cites it as evidence (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:1637-1649`). By contrast, the archive warning is clear and correct (`docs/archive/README.md:1-20`).

**Why it matters.** A dated filename is not a supersession control. These files sit outside the archive and are linked by current surfaces, so agents and operators can follow them without encountering the intended authority chain.

**Recommendation.** Move the 8/28 plan, `SECURITY-AUDIT-REPORT.md`, and `docs/deep-review.md` under `docs/archive/`; repair the two current links; add a generated “no superseded execution link outside archive” check. If the review prompts are still wanted, rebuild them from current standards rather than patching obsolete copies.

**Cost/risk of the fix.** Low runtime risk, medium link-churn risk. Preserve redirects or a checked link map so external issue references remain intelligible.

## What needs substantial change

### DOC-S01 Active authority contradicts the fixed product, authorization, durability, and composition contracts

**Verdict:** SUBSTANTIAL. **Severity:** high.

**Evidence.** The fixed contract limits interactive roles to AccountAdmin/PropertyManager and defers Staff User login/dashboard (`docs/comprehensive-beta-implementation-program-2026-08-25.md:43-50`); it defers Badge and prohibits competitive/Staff recognition (`docs/comprehensive-beta-implementation-program-2026-08-25.md:98-105`). `PRODUCT.md` instead defines Staff mobile progress, badges and leaderboard as an active audience and product purpose (`PRODUCT.md:9-17,41-42`), echoed by `DESIGN.md:112-128`. FND-02 explicitly requires obsolete `can()` guidance to be superseded (`docs/comprehensive-beta-implementation-program-2026-08-25.md:241-260`), yet root, standards, context, routes, shared, deep-review and the old security report all prescribe it (`CONTEXT.md:144-161`; `docs/standards.md:174-186`; `src/contexts/CONTEXT.md:149-163,252-256`; `src/routes/CONTEXT.md:153-164`; `src/shared/CONTEXT.md:152-163`; `docs/deep-review.md:453-483`; `SECURITY-AUDIT-REPORT.md:121-153`). The fixed durability contract requires state and facts to commit atomically (`docs/comprehensive-beta-implementation-program-2026-08-25.md:118-120`), while standards/context recipes still say persist then emit through the event bus (`docs/standards.md:174-186`; `src/contexts/CONTEXT.md:149-161`). Standards forbid production composition reading `.internal` (`docs/standards.md:194-225`), while the required contexts guide explicitly permits it (`src/contexts/CONTEXT.md:117-147`).

**Why it matters.** These are not stylistic disagreements. Following current required docs can reintroduce role-only authorization, non-atomic critical events, repository reach-through, or beta product surfaces the contract explicitly rejects.

**Recommendation.** Correct `PRODUCT.md` and `DESIGN.md` to two interactive beta experiences: manager application and public Guest Portal; retain Staff Participant only as manager-maintained data. Delete role-only authorization recipes and replace them with the actual ExecutionPolicy/permit flow plus client-affordance-only `can()` use. Replace “persist then emit” with owning atomic command-store/outbox rules. Make `docs/standards.md` the generated canonical snippet source and embed or link those snippets from layer guides; no hand-copied alternative recipes.

**Cost/risk of the fix.** Medium documentation change with high review sensitivity. The primary risk is overcorrecting UI affordance checks into server policy or incorrectly claiming every local-only mutation needs an outbox fact; use the existing mutation classifications as the source.

### DOC-S02 Root migration guidance is an unsafe split brain

**Verdict:** SUBSTANTIAL. **Severity:** high.

**Evidence.** The authoritative quickstart requires `DEPLOY_MIGRATE=1 pnpm db:migrate-deploy`, explicitly covering pinned Better Auth, staged Drizzle, registered sidecars, and provider-subject initialization (`README.md:21-27`). The accepted auth guide agrees and names the production wrapper and local sidecar sequence (`docs/auth-migrations.md:21-42`). Root `MIGRATION.md` instead says there are two systems, tells a first-time/operator path to run only `auth:migrate` then `db:migrate`, and says CI/CD should always do only those two (`MIGRATION.md:3-37,58-60`); its table description is also a tiny obsolete subset (`MIGRATION.md:15-21`). The DB context that should arbitrate this is itself stale at journal 0140/195 app tables (`src/shared/db/CONTEXT.md:5-30`), while the current journal reaches 0177 (`drizzle/meta/_journal.json:1237-1250`) and the data-fate authority import reports 242 models.

**Why it matters.** An operator following a root-level document can create a database without required sidecars/provider initialization. That can block startup or, worse, produce a partially provisioned environment whose schema appears migrated.

**Recommendation.** Delete `MIGRATION.md`; make `README.md` point to one refreshed `src/shared/db/CONTEXT.md` deployment section and the Better Auth-specific guide. Generate migration head, entry count, app-model count, registered sidecars, and ordered deploy stages from the actual deploy runner. Add a documentation assertion that no root/current guide presents `auth:migrate → db:migrate` as the complete deploy path.

**Cost/risk of the fix.** Low code risk and small prose change; high consequence if sequencing is misstated. Verify the generated sequence against the deploy runner and clean-database evidence before deleting the old file.

### DOC-S03 Documentation gates validate form while claiming semantic consistency

**Verdict:** SUBSTANTIAL. **Severity:** medium.

**Evidence.** The GOV-02 definition of done is “no known contradictory current guides” (`docs/comprehensive-beta-implementation-program-2026-08-25.md:1140-1155`), and its ledger claims exactly that implementation is complete (`docs/release-evidence/review/comprehensive-program-status-2026-08-26.json:1620-1657`). The context-doc checker validates four headings/event-table presence, not glossary, product fate, permission or reachability truth (`src/shared/governance/context-standards-matrix.test.ts:177-239`; authority shape at `src/shared/governance/context-standards-authority.ts:3-8`). The documentation authority test checks one program, one composition section, and supersession markers for only three named files (`src/shared/governance/documentation-authority.test.ts:8-80`). Both focused suites passed locally—14 matrix/ADR tests and 6 documentation-authority tests—despite DOC-I01/S01/S02. The status validator likewise validates schema/axis transitions only (`scripts/review/comprehensive-program-status.ts:52-72,92-180`).

**Why it matters.** A green check named “documentation authority” is stronger than no check only if readers understand its boundary. Here the names and ledger narrative imply semantic agreement the assertions do not examine, recreating false confidence with more machinery.

**Recommendation.** Do not build a prose theorem prover. Add a small set of high-consequence generated semantic invariants: beta audiences/roles and blocked surfaces; canonical Inbox statuses/target terms; authorization API roles; atomic fact wording; exact context list; route inventory; migration authority/head; ADR frontmatter/disposition; all referenced current paths. Rename remaining heading/table tests “documentation structure.” Require each implementation-complete package summary to cite one generated semantic assertion or carry the gap.

**Cost/risk of the fix.** Medium. Over-broad regexes will create noisy gates and encourage euphemistic wording; bind assertions to structured blocks/frontmatter and deliberately invalid fixtures rather than scanning arbitrary historical prose.

### DOC-S04 Contract the active documentation surface and separate provenance from guidance

**Verdict:** SUBSTANTIAL. **Severity:** low.

**Evidence.** Current-tree Python measurement returned: `docs/` 405 files/25,937,667 bytes; root+docs Markdown 269 files/56,840 lines; 22 `src/**/CONTEXT.md` guides/4,765 lines; combined 291 files/61,605 lines. Excluding `docs/archive/` and `docs/release-evidence/` still leaves 197 active human-doc files/38,749 lines. `docs/release-evidence/` is 97 files/19,580,934 bytes; `docs/archive/` is 137 files/20,173 Markdown lines; the still top-level historical July program is 36 files, including 34 Markdown files/9,256 lines. From the latest parent before the 21-day window (`f46d2cd690899eace479e6ec9e08d5bbb3fece4c`; first later commit 2026-08-13), `git diff --shortstat ... -- ':(glob)**/*.md'` reports 240 files changed, 24,779 insertions and 2,828 deletions: net +21,951 Markdown lines. The live scale is one Organization and six Properties (`docs/operations/capability-state-2026-09-02.md:1-15,83-101`).

**Why it matters.** Immutable evidence volume is defensible, but active prose grew faster than the authority checks can keep coherent. For a six-property beta, 38,749 current-guidance lines impose a review/search burden without proportionate operational risk reduction; duplicated facts are already drifting.

**Recommendation.** Use this concrete contraction:

1. Move all 36 files in `docs/product-readiness-program-2026-07/` under `docs/archive/`, retaining one archive index and preserving Google evidence links.
2. Move `SECURITY-AUDIT-REPORT.md`, `docs/deep-review.md`, and `docs/program-completion-plan-2026-08-28.md` to archive; repair `docs/operations/external-verification-execution-pack.md` and the 8/29 progress report links.
3. Delete `MIGRATION.md` after merging only valid unique material into the generated DB authority; correct `PRODUCT.md`/`DESIGN.md` rather than adding another beta-product page.
4. Trim current `CONTEXT.md` files to ownership, canonical language, invariants, active entry paths, dark/deferred posture and residual risks; move tutorials/migration chronology (especially Goal) to immutable evidence or archive.
5. Generate all counts, status tables, route/migration/context inventories and ADR frontmatter projections. Keep release evidence immutable but exclude it from default current-document search/navigation.

Set a measurable target for “current human guidance” (root Markdown + docs outside archive/release-evidence + `src/**/CONTEXT.md`) of **at most 160 files and 28,000 lines**, zero unmarked superseded instructions, and no hand-maintained numeric inventory. Archiving the July tree plus the three named stale documents and deleting `MIGRATION.md` would reach 159 files/~28,086 lines; removing at least 86 lines of Goal/root legacy duplication meets the target without touching evidence or ADR history.

**Cost/risk of the fix.** Medium link and discoverability risk, low runtime risk. Preserve provenance and add checked redirects/index links; do not delete release evidence, accepted ADR history, denial conditions, or operational recovery steps merely to hit the number.

## Proportionality ledger

| Machinery                                              |                                                                                                                 Measured cost | One-tenant/six-property value judgment                                                                | Disposition                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| All human Markdown/context prose                       |                                                              291 files / 61,605 lines; 16.2% of 380,495 non-test source lines | Too much to keep semantically synchronized by review, demonstrated by nine incorrect required guides. | Contract active guidance to ≤160 files/≤28,000 lines; retain evidence separately.   |
| Active human guidance after excluding archive/evidence |                                                                                                      197 files / 38,749 lines | Still excessive for the audience and operational surface that exist.                                  | Archive the 34-Markdown July program and named stale root/current documents.        |
| Immutable release evidence                             |                                                                               97 files / 19.58 MB, 75.5% of all `docs/` bytes | Size is justified as provenance only; unjustified if indexed as current guidance.                     | Keep immutable; segregate from search/navigation and derive summaries.              |
| ADR corpus                                             | 49 issued ADR files plus index; explicit static traceability: 23 test-linked, 13 production-only, 13 with no explicit ID link | Reasonable decision history, but manual status/path projection is already stale.                      | Keep history; generate metadata/status/path checks rather than adding ADRs.         |
| Documentation growth over the review window            |                                                                 240 Markdown files changed; +24,779/−2,828, net +21,951 lines | Rewrite added necessary evidence but also increased the coherence surface faster than semantic gates. | Make contraction a closure criterion, not a later cleanup aspiration.               |
| Focused documentation gates                            |                                     20 tests across three files passed in about 3 seconds, while direct contradictions remain | Runtime cost is cheap; confidence label is expensive and currently overstated.                        | Keep structural checks, add a small generated semantic contract, rename accurately. |
| Program status ledger                                  |                        42 rows; validator reports 0 formal closure but accepts missing evidence paths and stale numeric prose | Three-axis model is proportionate; free-form evidence is not.                                         | Deepen existing ledger schema instead of creating another catalogue.                |

## Unverified / needs a runtime check

- **[UNVERIFIED] Full sentence-level accuracy of the “sampled current” context guides.** Verify through owner review plus generated public API/event/job/route diffs; this review statically checked representative contract and reachability claims only.
- **[UNVERIFIED] Clean-database outcome from each documented migration path.** No database was started. On pinned Node 22.23.2, execute the production wrapper against an empty database and a production-shaped upgrade, then compare schema/sidecar/provider-subject evidence; do not run the intentionally incomplete `MIGRATION.md` path on shared state.
- **[UNVERIFIED] Deployed truth behind context claims about schedules, queues, provider outcomes, lifecycle recovery, exports, alerts, and Railway.** The repository itself says those require external evidence (`docs/operations/external-verification-execution-pack.md:7-32`).
- **[UNVERIFIED] Semantic enforcement for the 13 ADRs without explicit code/test ID references.** Absence of an ADR number is not absence of implementation; verify each decision against source behavior before adding traceability markers.
- Focused tests ran under Node 26.4.0 and emitted the repository's unsupported-engine warning; the parent should rerun the ADR/matrix/documentation-authority/status checks under pinned Node 22.23.2 before treating timing or execution as candidate evidence.
- The current source was not browser-, worker-, sidecar-, or Railway-exercised, per review constraints. No documentation claim about actual deployed reachability was promoted from static evidence.

## Opinion

The repository's evidence instincts are substantially better than its document architecture. The right simplification is not “less evidence”; it is fewer current narratives, more generated facts, and a hard boundary between immutable provenance and instructions someone should follow today. A 49-ADR history and large release-evidence store can be appropriate even for one tenant; nine contradictory required guides cannot.
