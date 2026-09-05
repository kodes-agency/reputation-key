# Context architecture, layering, duplication, and legacy deletion — state of the app, 2026-09-02

## Verdict

The most consequential remaining architecture defect is not a theoretical boundary violation: the live manager UI exposes both a legacy **Response SLA** and the canonical **Response Target**, while Dashboard/Fleet still calculate overdue work from the former and stop counting on local `published` state rather than provider-confirmed Google truth. The rewrite did genuinely eliminate production source-path reach-through: a current-tree census found 227 public-barrel imports, 33 narrowly allowed adapter-port imports, and zero production bypasses, and the runtime context graph has no cycle. That mechanical success is incomplete semantic isolation: 38 production files directly import 84 non-platform tables owned by another context, including Dashboard projections that encode Inbox/Review/Goal rules. The public barrels are also not “small”: 17 barrels expose 656 symbols, 488 of which have no named production import outside their defining context, and several explicitly export repositories or queues contrary to ARC-03. Team, Badge, and Leaderboard are honestly beta-dark and Badge/Leaderboard have been cut down well, but live row/FK reports and export/restore evidence do not yet exist in reviewed evidence, so physical deletion would be unsafe. Shared ownership and process composition are markedly stronger than the pre-rewrite state, but the remaining split response authority, semantic table reach-through, and inflated legacy/public surfaces mean ARC-03's outcome is only partially achieved.

## Scorecard

| Planned outcome (cite the package/§)                                                                                                                                                               | Current reality                                                                                                                                                                                                                                                                                                                                                                       | Verdict     | Severity |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- |
| One canonical Google **Response Target**, “not SLA,” stopped only by current live Google truth (§3.4.9; IBX-01.7; RPL-01.6)                                                                        | Two independently persisted/configured controls are rendered together; Dashboard and Fleet consume Identity's SLA and local reply `published` state (`docs/comprehensive-beta-implementation-program-2026-08-25.md:84`; `src/routes/_authenticated/settings/organization.tsx:33-42,64-71,89-98`; `src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts:35-53`) | SUBSTANTIAL | high     |
| Every retained context has a small capability/fact interface, not repositories, queues, or constructors (ARC-03.2; Done at `docs/comprehensive-beta-implementation-program-2026-08-25.md:488,501`) | All 17 have barrels, but they total 656 symbols; 488 have no named production import outside the owner; Goal, Inbox, Notification, and Review export repository/store/queue contracts (`src/contexts/goal/application/public-api.ts:24-29`; `src/contexts/review/application/public-api.ts:51-88`)                                                                                    | IMPROVE     | medium   |
| Cross-context imports use public APIs and production `.internal` reach-through is gone (ARC-03.2/4/Done)                                                                                           | 227 public imports + 33 adapter-port imports + 0 path bypasses; the only root `.internal` use is behind the documented simulation option (`src/composition.ts:781-808`; `docs/standards.md:215-224`)                                                                                                                                                                                  | ACHIEVED    | —        |
| Late-bound context cycles removed and one deterministic container composed (ARC-03.3–5)                                                                                                            | Runtime graph has only Dashboard→Metric, Goal→Metric, Integration→Property, Integration→Review and no strongly connected component; root projects named capability groups (`src/composition.ts:809-828`)                                                                                                                                                                              | ACHIEVED    | —        |
| Shared contains owned mechanisms, not unowned business policy (ARC-03.7)                                                                                                                           | A 24-area executable dependency policy and ownership table now exist, but a flat shared root still carries context-specific AI/response/provider policy and release scripts depend on `shared/testing` (`src/shared/architecture/shared-dependency-policy.ts:1-44`; `src/shared/CONTEXT.md:5-78`; `scripts/release/validate-bundle.ts:56-60`)                                         | IMPROVE     | medium   |
| Retire duplicate Goal/Team/Badge/Leaderboard models only after proof (FND-02, GOA-01, REC-01, CNV-01)                                                                                              | Active runtime authority is cut over and the three named legacy contexts are dark; Goal still retains 29 catalogued old-family entries and advertises legacy types; physical contraction lacks observed production inventory/restore proof (`src/contexts/goal/application/goal-authority-inventory.ts:44-172`; `src/contexts/team/CONTEXT.md:111-127`)                               | IMPROVE     | medium   |
| Accurate context documentation and mechanically checked boundaries (ARC-03.8/Done)                                                                                                                 | Enforcement is real, but the top-level context map omits Notification, Badge, and Leaderboard and 226 exports are documented in a governance allowlist rather than the owning context document (`src/contexts/CONTEXT.md:5-26`; `src/shared/governance/context-public-interface-authority.ts:346-357,614-635`)                                                                        | IMPROVE     | low      |

### Ranked architecture violations

| Rank | Violation                                                                                                                                                            | Reachable impact                                                                                                                                                                                                                                                            | Verdict / severity   |
| ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
|    1 | Legacy Response SLA competes with canonical Response Target, and Dashboard's stop condition is `replies.status = 'published'` rather than observed-live Google truth | Organization settings, property overview, and fleet overview are live route paths (`src/routes/_authenticated/settings/organization.tsx:57-122`; `src/routes/_authenticated/properties/$propertyId/index.tsx:4,24-25`; `src/contexts/dashboard/server/dashboard.ts:95-132`) | SUBSTANTIAL / high   |
|    2 | Context ownership is bypassed semantically through 84 non-platform foreign table imports in 38 production files                                                      | Active Dashboard, AI↔Review, Notification→Inbox, Portal↔Staff, and Identity→Integration paths; path lint reports them as shared-schema imports, not cross-context imports                                                                                                   | SUBSTANTIAL / medium |
|    3 | Public interfaces expose 656 symbols, including forbidden repository/queue shapes; 488 have no external named production import                                      | Enlarges every change boundary and permits new coupling even though current import paths are clean                                                                                                                                                                          | IMPROVE / medium     |
|    4 | Two retired Goal families remain as 29 catalogue entries/2,422 LOC of named source plus legacy exports and a test that protects `goalCompleted`                      | Network mutation is dark, but dead implementation is preserved as production code and public contract (`src/contexts/goal/CONTEXT.md:8-24,119-135,184-223`)                                                                                                                 | SUBSTANTIAL / low    |
|    5 | `integration/build.ts` remains 1,536 LOC and accepts a 47-dependency root input; Review ships a 239-line sequential test fake in a production store                  | Composition remains hard to audit; test-only code inflates a critical command store (`src/contexts/integration/build.ts:421-435`; `src/contexts/review/infrastructure/reply-command-store.ts:1041-1285`)                                                                    | IMPROVE / low        |
|    6 | Release authority imports `src/shared/testing`                                                                                                                       | A production/release concern depends on test-only namespace, outside the shared dependency fence (`scripts/release/validate-bundle.ts:56-60`; `scripts/release/promote-local-evidence.ts:3`)                                                                                | IMPROVE / medium     |
|    7 | Team remains 26 production files/3,673 LOC although its build is empty                                                                                               | Full schema deletion is correctly blocked, but unused CRUD/product implementation is not needed for read-only reconciliation/export                                                                                                                                         | IMPROVE / low        |
|    8 | Opaque import-reference and review-cursor stores separately implement the same bounded signed ephemeral-store mechanics                                              | Duplicate limits/key/publication/expiry behavior can drift (`src/contexts/integration/infrastructure/opaque-import-reference-store.ts:25-40`; `src/contexts/integration/infrastructure/google-review-cursor-store.ts:4-20`)                                                 | IMPROVE / low        |

## What was achieved

### CTX-A1 Production source-path boundaries are now real

**Evidence.** The rule resolves aliases and relative imports, allows only a foreign `application/public-api` plus the exact adapter→port exception, and checks imports, exports, and dynamic imports (`eslint-rules/cross-context-public-api.mjs:1-12,44-90`). It is enabled as an error for `src/contexts/**/*.{ts,tsx}` (`eslint.config.js:1296-1305`). A read-only TypeScript-AST census over non-test context files, applying that same resolution rule, produced:

```text
public-barrel statements: 227
adapter-to-foreign-port statements: 33
other foreign-context statements: 0
```

The inbound result for all 17 packages is:

| Context      | all TS/TSX files / LOC | production files / LOC | semantic public exports | inbound public / adapter-port / bypass statements | Assessment                                                                                    |
| ------------ | ---------------------: | ---------------------: | ----------------------: | ------------------------------------------------: | --------------------------------------------------------------------------------------------- |
| Activity     |           102 / 13,771 |             67 / 7,091 |                       5 |                                         0 / 0 / 0 | Small interface; no inbound context dependency                                                |
| AI           |           106 / 36,207 |            68 / 16,768 |                      23 |                                         0 / 0 / 0 | Barrel is moderate; runtime is reached from routes/workers rather than another context barrel |
| Badge        |             10 / 2,122 |                5 / 717 |                       3 |                                         0 / 0 / 0 | Correctly historical/type-only                                                                |
| Dashboard    |            64 / 10,008 |             40 / 5,042 |                      48 |                                         0 / 0 / 0 | Oversized export surface for a route-facing projection context                                |
| Goal         |           108 / 26,879 |            55 / 12,265 |                      57 |                                         3 / 0 / 0 | Inflated by retained legacy/governed families                                                 |
| Guest        |           134 / 26,063 |            76 / 12,663 |                      25 |                                        11 / 0 / 0 | Bounded and used                                                                              |
| Identity     |           234 / 43,057 |           130 / 21,161 |                      36 |                                       14 / 29 / 0 | Named API is bounded; high adapter-port demand reflects auth/people seams                     |
| Inbox        |           179 / 45,739 |           104 / 19,224 |                      90 |                                        14 / 0 / 0 | Not small; event/cutover/target/store types dominate                                          |
| Integration  |           254 / 55,332 |           148 / 29,434 |                      83 |                                         6 / 0 / 0 | Not small; all 83 are separately allowlisted as “documented elsewhere”                        |
| Leaderboard  |             13 / 3,282 |              6 / 1,372 |                       7 |                                         0 / 0 / 0 | Content-free contraction report only                                                          |
| Metric       |           102 / 15,681 |             58 / 7,814 |                      26 |                                        10 / 0 / 0 | Bounded governed read API                                                                     |
| Notification |           189 / 31,415 |           107 / 15,910 |                      65 |                                         0 / 0 / 0 | Port/event barrel much larger than external demand                                            |
| Portal       |           211 / 41,291 |           125 / 21,160 |                      32 |                                        26 / 0 / 0 | Relatively deep interface with real demand                                                    |
| Property     |           114 / 19,488 |             63 / 8,591 |                      27 |                                        21 / 2 / 0 | Bounded and heavily used                                                                      |
| Review       |           176 / 47,346 |           102 / 22,650 |                     104 |                                        35 / 1 / 0 | Largest barrel; exports queue/repository/use-case contracts                                   |
| Staff        |             68 / 9,871 |             37 / 3,974 |                      15 |                                        87 / 1 / 0 | Small, load-bearing facts surface                                                             |
| Team         |             49 / 7,380 |             26 / 3,673 |                      10 |                                         0 / 0 / 0 | Historical barrel only; should shrink with contraction                                        |

The export counts were obtained with TypeScript 5.9 `createProgram` + `checker.getExportsOfModule` against each `application/public-api.ts`; the command output was `activity 5, ai 23, badge 3, dashboard 48, goal 57, guest 25, identity 36, inbox 90, integration 83, leaderboard 7, metric 26, notification 65, portal 32, property 27, review 104, staff 15, team 10`. Production files exclude `*.test.*`, `*.spec.*`, stories, and `__tests__`.

**Why it matters.** This directly fixes the previous report's ARCH-01 source-path reach-through: new casual imports from a foreign domain/infrastructure/server folder now fail mechanically rather than relying on review.

**Recommendation.** Keep the rule and its negative controls. Add the semantic table-owner rule described in CTX-S2 rather than weakening this rule.

**Cost/risk of the fix.** None for the achieved path rule; the risk is treating its zero count as proof that data/business ownership is also isolated.

### CTX-A2 Runtime context cycles and ordinary `.internal` consumption are gone

**Evidence.** A read-only AST graph excluding `import type` produced four runtime edge families—Dashboard→Metric (2 import statements), Goal→Metric (1), Integration→Property (3), Integration→Review (1)—and no cycle. Composition projects named public/worker/maintenance/lifecycle groups (`src/composition.ts:809-828`). Its only reads of context `.internal` repositories are inside `options?.exposeSimulationRuntime` (`src/composition.ts:781-808`), exactly the exception documented at `docs/standards.md:215-224`.

**Why it matters.** This is a concrete resolution of the pre-rewrite ARCH-02/ARCH-07 failure mode: build order no longer creates runtime context cycles and ordinary containers do not receive repository service locators.

**Recommendation.** Protect the four-edge runtime graph with a generated snapshot that distinguishes runtime imports from erased type imports.

**Cost/risk of the fix.** Low; the main risk is a noisy graph if type-only edges are accidentally treated as runtime dependencies.

### CTX-A3 Team, Badge, and Leaderboard are beta-dark at real entry points

**Evidence.** Their builds construct empty APIs and no repositories/jobs (`src/contexts/team/build.ts:1-16`; `src/contexts/badge/build.ts:1-17`; `src/contexts/leaderboard/build.ts:1-18`). `team.use`, `badge.use`, and `leaderboard.use` are unconditionally blocked (`src/shared/auth/beta-capabilities.ts:145-171`), and their fate records explicitly prohibit reactivation (`src/shared/governance/capability-fate.ts:107-121`). The stale `/leaderboard` address redirects before any read (`src/routes/_authenticated/leaderboard.tsx:9-21`). Badge's evaluation/award machinery and Leaderboard's rank/scoring machinery have actually been removed (`src/contexts/badge/CONTEXT.md:5-12,61-71`; `src/contexts/leaderboard/CONTEXT.md:5-15,52-61`).

**Why it matters.** This is reachability, not catalogue-only governance: a persisted allowlist cannot reopen the code and the only retained live path is tenant export, not product activation.

**Recommendation.** Keep the compile-time blocks until replacement recognition has a separate capability. Do not count export contributors as product activation.

**Cost/risk of the fix.** No immediate fix. Premature schema/event-envelope deletion would risk losing historical tenant data.

### CTX-A4 Several previously duplicated rules now have one explicit authority

**Evidence.** Google review-comment translation parsing is one implementation (`src/shared/google-review-comment.ts:1-14,49-63`) called by the live provider adapter (`src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts:450-464`) and the repair command (`scripts/ops/reparse-review-translations.ts:46-49,106-109`). Responsible-manager eligibility is one pure rule with explicit Identity/Staff dependencies (`src/shared/responsible-manager-eligibility.ts:4-31,33-70`) used by Portal and Property adapters rather than copied (`src/contexts/portal/infrastructure/adapters/portal-manager-eligibility.ts:17-50`; `src/contexts/property/infrastructure/adapters/property-manager-eligibility.ts:14-37`). Review's source-content read eligibility is one owner rule (`src/contexts/review/application/source-content-lifecycle.ts:22-33`); Dashboard's unavoidable SQL form is explicitly identified as a copy and has an equivalence integration test (`src/contexts/dashboard/infrastructure/read-facade.ts:112-118`; `src/contexts/dashboard/infrastructure/repositories/attention-eligibility-equivalence.test.ts:1-4,95-125`).

**Why it matters.** These are good examples of distinguishing a canonical rule from a performance-specific representation and testing equivalence instead of pretending the copy does not exist.

**Recommendation.** Preserve the exact Review↔Dashboard eligibility equivalence check; apply the same pattern to every deliberate cross-owner projection in CTX-S2.

**Cost/risk of the fix.** Low maintenance cost; the DB-backed equivalence test needs a reliable isolated database.

## What is genuinely good

### CTX-G1 `shared/` now has explicit ownership and an executable dependency graph

**Evidence.** The shared context document assigns ownership across auth, DB, events/outbox, Google provider control, governance, observability, routing, testing, UI, and root compatibility contracts (`src/shared/CONTEXT.md:5-46`). The dependency policy defines production areas, including a distinct test-only area, and enumerates permitted dependencies rather than using a wildcard super-context (`src/shared/architecture/shared-dependency-policy.ts:1-22,31-44,44-162`). Root-level shared categories and the cross-process AI sidecar kernel are named separately (`src/shared/CONTEXT.md:48-78,80-122`).

**Why it matters.** This is load-bearing: shared is 204k LOC, so an ownership table plus executable graph materially reduces the previous ARCH-09 “anything imports anything” risk.

**Recommendation.** Keep cross-process cryptographic/wire/version contracts, IDs/value types, time, auth enforcement, DB/outbox/queue/cache/observability mechanisms, and deliberately multi-consumer provider normalization in shared. Require every exception to name its context owner and consumers.

**Cost/risk of the fix.** The policy itself is worth its maintenance cost; the failure mode is letting catalogue size substitute for relocating context-specific rules.

### CTX-G2 Legacy contraction gates are appropriately harder than “zero imports”

**Evidence.** Team requires zero unexplained reconciliation rows, no static/runtime entry point, data retention/export decisions, one verified release, and restore proof (`src/contexts/team/CONTEXT.md:111-127`). Badge and Leaderboard likewise require inventory plus export/restore proof before schema removal (`src/contexts/badge/CONTEXT.md:98-112`; `src/contexts/leaderboard/CONTEXT.md:100-113`). The read-only recognition repository captures exact counts and reconstructable FKs in a repeatable-read snapshot, while the application report treats the result as a candidate rather than deletion authority (`src/contexts/leaderboard/infrastructure/legacy-recognition-inventory.repository.ts:20-70,149-164`; `src/contexts/leaderboard/application/legacy-recognition-inventory.ts:241-294`).

**Why it matters.** The database can contain historical rows even when code is dark. This gate prevents the exact false-confidence error of declaring a model deleted because TypeScript imports reached zero.

**Recommendation.** Retain these gates and produce the missing live evidence; do not weaken them for beta speed.

**Cost/risk of the fix.** Low code risk, moderate operational effort: a scoped production read, export/restore rehearsal, and reviewed contraction migration.

### CTX-G3 Most large Integration/Review files are deep infrastructure, not automatically architecture failures

**Evidence.** The largest stores own fenced, transactional workflows behind ports rather than being imported across contexts. For example, `google-import-v2-store` backs one import saga contract with claim fences, leases, retry revisions, and terminalization (`src/contexts/integration/application/ports/google-import-v2-store.port.ts:5-71,209-280`); Review's AI draft acceptance rechecks authorization/source/profile/reply fences inside one transaction (`src/contexts/review/infrastructure/ai-suggested-draft-store.ts:57-69,100-177`).

**Why it matters.** Splitting cohesive transaction logic only to meet a line limit would make invariants harder to see and add indirection. The actual accidental concentration is build orchestration and test-only helpers, not every large persistence implementation.

**Recommendation.** Keep transaction/state-machine modules cohesive; split along independently named lifecycle capabilities only where the port is also broad.

**Cost/risk of the fix.** A careless split risks breaking atomicity. Refactor behind unchanged ports and preserve transaction boundaries.

## What should be improved

### CTX-I1 Public barrels are mechanically clean but materially too broad

**Evidence.** The compiler census totals 656 exports. A second AST census of non-test production named imports from outside each defining context found only 168 distinct exported names referenced, leaving **488 with no named external production import**. This does not prove all 488 are dead, but it proves they are not currently serving the cross-context boundary they enlarge. The strongest contract violations are explicit: `GoalRepository` (`src/contexts/goal/application/public-api.ts:24-29`), `ResponseTargetPolicyStore` (`src/contexts/inbox/application/public-api.ts:27-36`), four Notification repository ports (`src/contexts/notification/application/public-api.ts:76-91`), and Review queue/snapshot repositories (`src/contexts/review/application/public-api.ts:51-83`). The authority then carries 226 `DOCUMENTED_ELSEWHERE` names across eight contexts—Integration alone all 83 exports (`src/shared/governance/context-public-interface-authority.ts:346-357,500-545,614-635`; read-only authority evaluation output: `groups=8, names=226`).

**Why it matters.** ARC-03 requires application capabilities and typed facts, specifically not repositories/queues/use-case constructors (`docs/comprehensive-beta-implementation-program-2026-08-25.md:487-490`). A giant legal barrel still enables coupling; an exhaustive secondary allowlist proves consistency but does not make the interface small.

**Recommendation.** For each barrel, generate `export → external production importers`; retain capability functions, DTO/fact/event types that have real consumers, and exact adapter contracts. Remove legacy and unused exports in the same cutover. Replace repository/queue types with narrow application-owned capability interfaces at their actual Integration/Notification/Inbox consumers.

**Cost/risk of the fix.** Medium. Most removals are type-only and low risk, but queue/provider contracts have worker consumers; migrate one seam at a time and use the compiler census as the deletion proof.

### CTX-I2 Release code must not depend on the testing namespace

**Evidence.** `scripts/release/validate-bundle.ts` imports both `#/shared/testing/beta-local-evidence` and `#/shared/testing/release-bundle` (`scripts/release/validate-bundle.ts:56-60`); `scripts/release/promote-local-evidence.ts` imports the same beta-local evidence module (`scripts/release/promote-local-evidence.ts:3`). Shared's dependency authority explicitly classifies testing as test-only (`src/shared/architecture/shared-dependency-policy.ts:31-44`), but script classification does not prevent this direction.

**Why it matters.** Release validation is production governance. Housing its input parser/manifest contract under testing makes deployment authority transitively depend on fixtures/helpers and creates a namespace escape that the context boundary result does not measure.

**Recommendation.** Move the two release contracts to `src/shared/release/` (or a release-owned script module), migrate release and test callers, then remove the testing re-exports. Add a script→`shared/testing` negative control.

**Cost/risk of the fix.** Low code risk; medium release risk if changed without running the focused release-bundle fixtures. Preserve formats byte-for-byte.

### CTX-I3 Move only context-specific shared policy; retain true cross-process kernels

**Evidence.** Shared root production is dominated by flat `ai-*` modules, while the document describes these as an AI sidecar kernel (`src/shared/CONTEXT.md:80-122`). `response-sla.ts` is explicitly Identity-owned business configuration consumed only by Dashboard (`src/shared/domain/response-sla.ts:1-19`), and it is obsolete under the fixed Response Target contract. By contrast, manager eligibility names its Staff ownership and takes explicit cross-context facts (`src/shared/responsible-manager-eligibility.ts:4-31`), and the AI transport/crypto/profile contracts are used across the web/worker/sidecar process boundary.

**Why it matters.** “Move everything out of shared” would be as harmful as the old super-context. The useful criterion is ownership plus genuine multi-process/multi-module consumption, not file location alone.

**Recommendation.** Delete `shared/domain/response-sla.ts`; move UI-only AI labels and Portal-only brand-profile server policy to their owners; group retained AI wire/crypto/fingerprint/profile contracts under an explicit AI-owned shared contract package. Keep pure responsible-manager eligibility shared unless composition can expose one equally explicit cross-context eligibility capability without creating an Identity↔Staff cycle.

**Cost/risk of the fix.** Low-to-medium. Pure moves are compiler-guided; moving cross-process types risks web/sidecar protocol skew, so keep their version constants and digest tests together.

### CTX-I4 Finish decomposition at the two accidental concentration points

**Evidence.** `src/contexts/integration/build.ts` is 1,536 lines and explicitly accepts a 47-property dependency object because “construction is query-free” (`src/contexts/integration/build.ts:421-435`). That preserves behavior, but ARC-03 called for context-owned build modules and narrow adapters (`docs/comprehensive-beta-implementation-program-2026-08-25.md:489-490`). Review's 1,285-line `reply-command-store.ts` includes a 239-line exported sequential in-memory implementation used as test support (`src/contexts/review/infrastructure/reply-command-store.ts:1041-1285`).

**Why it matters.** A 47-dependency build is an audit bottleneck, and test support in the production module makes its apparent runtime size/exports misleading. Neither requires splitting atomic stores.

**Recommendation.** Split Integration construction into named Google connection/import/content-authorization/provider-lifecycle builders with typed sub-inputs; keep one `buildIntegrationContext` coordinator. Move the sequential reply store into test support and import it only from tests.

**Cost/risk of the fix.** Medium for Integration because missed wiring can darken a worker capability; low for the test fake. Preserve the returned capability groups and run focused build/registration tests.

### CTX-I5 Collapse duplicated ephemeral-store mechanics, not the domain records

**Evidence.** `opaque-import-reference-store.ts` and `google-review-cursor-store.ts` separately define HMAC key versions, a 10,000-per-Organization bound, publication-attempt limits, clock skew, expiry, schema/index, and byte-budget behavior (`src/contexts/integration/infrastructure/opaque-import-reference-store.ts:25-40`; `src/contexts/integration/infrastructure/google-review-cursor-store.ts:4-20`). Both already sit on the same provider ephemeral store/keyring mechanisms.

**Why it matters.** The import reference and review cursor are different domain records, but duplicating the bounded signed-index lifecycle makes security and capacity changes easy to apply to one and miss in the other.

**Recommendation.** Extract one narrow Integration-owned `BoundedSignedEphemeralIndex` helper for signing/versioning/publication/TTL/budget mechanics; keep distinct schemas, validation, errors, and domain APIs.

**Cost/risk of the fix.** Low-to-medium. Golden token/expiry tests must prove no wire-format change; do not merge the domain stores themselves.

### CTX-I6 Contract Team source now while retaining data evidence

**Evidence.** Team's build is empty (`src/contexts/team/build.ts:9-16`) and its document says operator/release reconciliation is the sole remaining reachability (`src/contexts/team/CONTEXT.md:70-82`), yet the package still contains 26 production files/3,673 LOC, including CRUD repositories and historical application behavior. Badge is only 5 production files/717 LOC and Leaderboard 6/1,372, demonstrating the smaller contraction shape is achievable.

**Why it matters.** Schema deletion must wait, but inert create/update/list behavior is not needed to count, reconcile, export, or restore rows. Keeping executable-looking product code increases accidental reactivation surface.

**Recommendation.** Retain only schema, historical event decoder, read-only people reconciliation, export/restore/lifecycle contributor, and inert build. Delete unused Team command/use-case/repository paths after a fresh production-import and operator-command inventory; recover rollback implementation from version control, as Badge/Leaderboard already do.

**Cost/risk of the fix.** Low runtime risk because the code is uncomposed; medium migration risk if a reconciliation script imports a repository directly. The fresh inventory is mandatory.

### CTX-I7 Make the 17-context map and API docs tell the same truth as enforcement

**Evidence.** `src/contexts/CONTEXT.md` lists 14 package rows and omits Notification, Badge, and Leaderboard (`src/contexts/CONTEXT.md:5-26`) even though its later build-order section claims all 17 (`src/contexts/CONTEXT.md:117-147`). The public-interface authority allows family descriptions backed by 226 separately maintained names (`src/shared/governance/context-public-interface-authority.ts:346-352`).

**Why it matters.** ARC-03's Done condition is an accurate context document, not merely a passing checker. A new maintainer reading the map sees a different architecture from the enforced registry.

**Recommendation.** Add the three omitted contexts with explicit active/dark status. Put each retained public capability/fact family in the owner document and reserve `DOCUMENTED_ELSEWHERE` for small generated families, not whole 83-symbol barrels.

**Cost/risk of the fix.** Low; documentation-only plus focused authority check.

## What needs substantial change

### CTX-S1 Delete the legacy Response SLA authority and make Dashboard read Inbox target facts

**Evidence.** The fixed contract says “Google Review `Response Target`, **not SLA**” and only `confirmed_on_google` stops it (`docs/comprehensive-beta-implementation-program-2026-08-25.md:84`). Inbox implements versioned Organization/property target policy with a 48-hour default (`src/contexts/inbox/domain/response-target.ts:3-20,55-88`) and persists it independently (`src/contexts/inbox/infrastructure/response-target-policy.store.ts:46-128,131-170`). Identity still owns a separate `responseSlaHours` getter/setter (`src/contexts/identity/server/organizations.response-sla.ts:23-40,52-81`). The settings route loads and mutates both authorities in parallel (`src/routes/_authenticated/settings/organization.tsx:33-54,64-71,81-98`) and the page renders adjacent `ResponseSlaCard` and `ResponseTargetSettingsCard` controls (`src/components/features/organization/organization-settings-page.tsx:130-149`). Dashboard reads the Better Auth organization SLA (`src/contexts/dashboard/server/dashboard.ts:113-132`) and considers any local reply with `status='published'` answered (`src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts:35-53`; fleet duplicates it at `src/contexts/dashboard/infrastructure/adapters/fleet-overview-projection.adapter.ts:445-458`). Inbox, correctly, completes only on exact current `confirmed_on_google` or `external_current_live` observation (`src/contexts/inbox/CONTEXT.md:61-76`; `src/contexts/inbox/infrastructure/inbox-command-store.ts:3344-3346`).

**Why it matters.** This is a reachable contradiction: changing Response Target does not change Dashboard urgency, changing SLA does not change reminders/target analytics, provider-acknowledged-but-unobserved replies disappear from Dashboard too early, and externally created current-live replies can remain “unanswered” there. It directly compromises the manager's “what needs attention” journey.

**Recommendation.** Delete `ResponseSlaCard`, Identity's SLA server functions/persistence field usage, `shared/domain/response-sla.ts`, Dashboard `slaCutoff`, and both SQL predicates. Expose one Inbox application read projection returning per-property active/overdue Google target counts from handling-cycle target facts and exact observed-live completion; inject it into Dashboard/Fleet. Migrate existing SLA values once only if no explicit Response Target policy exists, with a recorded policy version, then remove the old field.

**Cost/risk of the fix.** Medium. The migration must define precedence for tenants with both values and preserve Dashboard query budgets. A dual-write/shim would prolong the defect; use a one-time clean cutover and parity check old-vs-new counts before removal.

### CTX-S2 Add semantic table-ownership enforcement and replace unreviewed cross-owner queries

**Evidence.** `DATA_FATE_AUTHORITY` gives every table export one owner (`src/shared/governance/data-fate-authority.ts:1-44,88-100`). A read-only compiler/AST join of that authority to non-test context imports found **84 non-platform foreign table-symbol imports, 44 tables, 38 production files, and 30 owner edges**. Largest edges were Identity→Integration 8, Team→Staff 8, Notification→Inbox 6, Review→AI 5, Review→Property 4, AI→Review 4, and Dashboard→Metric/Review/Portal 4 each. Representative active paths are Dashboard's attention/read/setup projections (`src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts:10-29`; `src/contexts/dashboard/infrastructure/read-facade.ts:27-32`; `src/contexts/dashboard/infrastructure/repositories/setup-checklist.repository.ts:4-12`), AI's direct Review-table aggregates (`src/contexts/ai/infrastructure/adapters/ai-output-store.adapter.ts:13-27`; `src/contexts/ai/infrastructure/adapters/ai-property-aggregate-store.adapter.ts:3-18`), Review's direct AI authorization reads (`src/contexts/review/infrastructure/ai-suggested-draft-store.ts:3-13,137-177`), and Notification's direct Inbox lookups (`src/contexts/notification/infrastructure/adapters/inbox-item-lookup.adapter.ts:10-15`). The path rule cannot see these as cross-context because every import begins `#/shared/db/schema` (`eslint-rules/cross-context-public-api.mjs:44-64`).

**Why it matters.** Not every foreign table read is wrong: atomic cross-aggregate fencing, export/restore, legacy reconciliation, and measured optimized projections need narrow exceptions. But today ownership is descriptive only. Dashboard's Response SLA bug shows the failure mode: a legal shared-schema import silently copied another context's completion rule and drifted from it.

**Recommendation.** Build an executable `context → table export` rule from `DATA_FATE_AUTHORITY`. Default-deny foreign owners; allow exact `(importer file, table, access mode, reason, expiry/contract test)` entries for atomic command stores, read-only export/reconciliation, and optimized projections. Replace casual reads with owner public facts/projections. First migrate Dashboard to Inbox target facts, Notification to a bounded Inbox notification-facts lookup, and resolve AI↔Review ownership by naming the existing cross-aggregate transaction store rather than pretending each direction is independent. Keep platform outbox/receipt tables as explicit shared-mechanism exceptions.

**Cost/risk of the fix.** High implementation breadth but bounded conceptual change. Moving transaction reads behind remote-style APIs can destroy atomicity; exact allowlisted command-store exceptions are safer than blanket purity. Roll out owner edge by edge with query parity and tenant-scope tests.

### CTX-S3 Delete executable legacy Goal families; retain only contraction evidence

**Evidence.** Goal's own authority says `goal_programs` is canonical and older `goals/goal_progress` plus `goal_definitions/goal_periods` are migration sources only (`src/contexts/goal/CONTEXT.md:8-24`). Its executable catalogue nevertheless names 29 retained legacy/governed entries: CRUD, reads, event handlers, jobs, schedules, and a fixture writer (`src/contexts/goal/application/goal-authority-inventory.ts:44-172,173-260`). The 15 named Goal-context source files alone are 2,422 LOC (read-only file census). `buildGoalContext` correctly constructs only GoalProgram and explicitly leaves pre-beta CRUD uncomposed (`src/contexts/goal/build.ts:1-6,83-151`), but `application/public-api.ts` still exports old DTOs, `GoalRepository`, legacy use-case types, `GoalCompleted`, and `goalCompleted` (`src/contexts/goal/application/public-api.ts:9-35,104-120`), and `public-api.test.ts` specifically protects the old factory (`src/contexts/goal/application/public-api.test.ts:7-21`). The server surface is gone/410-denied (`src/contexts/goal/CONTEXT.md:209-223`).

**Why it matters.** Runtime authority is correctly cut over, but preserving dead product implementation and advertising it as public API recreates the pre-rewrite “multiple models, one supposedly canonical” failure. Git already preserves rollback history; production source should preserve data interpretation, not an executable alternative product.

**Recommendation.** Remove legacy Goal DTO/repository/event constructors from the public barrel immediately after the external-import census remains zero. Retain one read-only data/FK inventory, export/restore decoder, and migration mapper; delete uncomposed CRUD, event handlers, schedules/jobs, 410 compatibility implementation, fixture writer, and tests whose only contract is legacy executability. Contract physical tables only after the existing live inventory/export/restore gate passes.

**Cost/risk of the fix.** Low runtime risk and medium migration risk. Separate source deletion from schema deletion; validate that operator/export tools depend only on the retained reader before removing files.

## Duplication register

| Rule/mechanism                      | Canonical owner                                                                                                 | Copies / consumers                                               | Current judgment                                                              | Required action                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| Google Review timing/completion     | Inbox Response Target facts and observed-live Review callback (`src/contexts/inbox/CONTEXT.md:61-76`)           | Identity Response SLA, Dashboard attention SQL, Fleet SQL        | Diverged, reachable                                                           | CTX-S1 clean deletion/cutover                            |
| Review content serving eligibility  | Review `isContentEligibleForRead` (`src/contexts/review/application/source-content-lifecycle.ts:22-33`)         | Dashboard SQL predicate                                          | Managed duplicate with equivalence test                                       | Keep and protect                                         |
| Google translated comment parsing   | Integration-owned provider normalization, shared pure parser (`src/shared/google-review-comment.ts:1-14,49-63`) | Provider adapter + repair script                                 | One implementation, two valid consumers                                       | Keep shared with named Integration ownership             |
| Responsible-manager eligibility     | Staff/Identity composite pure rule (`src/shared/responsible-manager-eligibility.ts:4-31`)                       | Portal and Property adapter wrappers                             | One implementation; wrappers only supply facts                                | Keep unless replaced by one cycle-free capability facade |
| Signed bounded ephemeral references | Integration                                                                                                     | Opaque import reference store + Google review cursor store       | Mechanics duplicated                                                          | CTX-I5 extract narrow helper                             |
| Goal product model                  | GoalProgram                                                                                                     | Legacy Goal + intermediate GovernedGoal implementation/catalogue | Runtime-dark but executable/public source retained                            | CTX-S3 delete implementation, retain data reader         |
| Setup/attention/readiness facts     | Integration/Portal/Property/Review/Inbox/Goal/Metric owners                                                     | Dashboard raw-table projections                                  | Deliberate projection shape but mostly unclassified; one known semantic drift | CTX-S2 owner contracts + parity entries                  |

## Legacy deletion readiness

| Legacy context | Current production weight | Runtime state                                                                                                                            | Data/export state                                                                                                                                                                          | Honest deletion verdict                                                                                             |
| -------------- | ------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Team           |      26 files / 3,673 LOC | Empty build; no route/server/job; blocked capability (`src/contexts/team/CONTEXT.md:13-28,46-68`)                                        | Export contributor is composed; people/Team report exists; current live zero-unexplained/restore evidence not reviewed (`src/composition/organization-export-contributors.ts:21-36,65-85`) | Product implementation can be further deleted now after fresh import inventory; schema/event envelope **not ready** |
| Badge          |         5 files / 717 LOC | Evaluation/award mechanics removed; blocked; neutral historical notification rendering only (`src/contexts/badge/CONTEXT.md:5-29,48-71`) | Read-only export covers retained tenant rows; live row/FK and restore result unverified (`src/contexts/badge/CONTEXT.md:73-112`)                                                           | Runtime contraction achieved; schema/event envelope **not ready**                                                   |
| Leaderboard    |       6 files / 1,372 LOC | Ranking/scoring/server/job removed; route redirects; blocked (`src/contexts/leaderboard/CONTEXT.md:5-25,38-61`)                          | 13-table content-free inventory + export exist; live report/restore result unverified (`src/contexts/leaderboard/CONTEXT.md:63-113`)                                                       | Runtime contraction achieved; schema **not ready**                                                                  |

The blockers are real, not bureaucratic: exact production row counts and schema-qualified inbound/outbound FKs; Team/people zero unexplained reconciliation; tenant export completeness; isolated restore readability; one verified release without a compatibility reader; and a reversible reviewed migration (`docs/operations/legacy-people-team-contraction.md:29-101`; `src/contexts/team/CONTEXT.md:111-127`). Zero TypeScript imports alone cannot answer any of those questions.

## Proportionality ledger

The tenant reality is one Organization and six Properties (`docs/operations/capability-state-2026-09-02.md:147-151`) in cohort `railway-closed-beta-1` (`docs/operations/capability-state-2026-09-02.md:83-87`). Against that, the context layer is 17 packages, 2,113 TS/TSX files, and 434,932 LOC; production alone is roughly 225k LOC by the census above. The issue is not “17 contexts for six properties”—the domain boundaries are mostly coherent—but the amount of boundary/governance surface required to explain them:

- 656 public symbols for 168 externally named production consumers; 488 unconsumed names.
- 84 non-platform foreign-owner table imports and 30 owner edges hidden behind one shared schema namespace.
- `src/shared` is 204k LOC; `src/shared/governance` alone is 24,042 LOC across 45 files, including a 6,348-line entry-point catalogue and 3,044-line event/job catalogue (fixed review-input census).
- 226 public exports require a second “documented elsewhere” allowlist.
- Three beta-dark contexts still cost 5,762 production LOC; Team accounts for 3,673.
- Two old Goal families cost at least 2,422 LOC in the 15 files explicitly named by their own retained-authority catalogue, before schema/domain/export support.

### Largest Integration production sources

Read-only line census, excluding tests/stories:

|   LOC | File                                                                                      | Classification                                                                            |
| ----: | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1,887 | `src/contexts/integration/infrastructure/google-import-v2-store.ts`                       | Mostly justified: one durable saga/claim/retry store; broad port is a future split signal |
| 1,536 | `src/contexts/integration/build.ts`                                                       | Accidental concentration: 47-dependency composition module; split named builders          |
| 1,467 | `src/contexts/integration/infrastructure/opaque-import-reference-store.ts`                | Justified security infrastructure, but shares duplicated mechanics with cursor store      |
| 1,146 | `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts`           | Justified provider adapter; keep provider translation/error handling together             |
|   736 | `src/contexts/integration/infrastructure/google-content-authorization-check.ts`           | Justified authorization/fencing policy                                                    |
|   677 | `src/contexts/integration/infrastructure/google-review-cursor-store.ts`                   | Justified store; duplicate primitive should be extracted                                  |
|   651 | `src/contexts/integration/application/google-import-v2-processor.ts`                      | Core import saga orchestration                                                            |
|   629 | `src/contexts/integration/infrastructure/repositories/credential-lifecycle.repository.ts` | Justified credential lifecycle persistence                                                |
|   598 | `src/contexts/integration/application/google-import-transaction.ts`                       | Core atomic import contract                                                               |
|   554 | `src/contexts/integration/application/google-import-command-authorizer.ts`                | Core authorization policy                                                                 |

### Largest Review production sources

|   LOC | File                                                                                           | Classification                                                      |
| ----: | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1,371 | `src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts`       | Justified reconciliation persistence; large but cohesive            |
| 1,285 | `src/contexts/review/infrastructure/reply-command-store.ts`                                    | Core atomic store plus accidental 239-line test fake                |
|   899 | `src/contexts/review/infrastructure/google-reply-observation-store.ts`                         | Core provider-truth state persistence                               |
|   846 | `src/contexts/review/infrastructure/repositories/source-content-lifecycle-store.repository.ts` | Justified retention/lifecycle store                                 |
|   846 | `src/contexts/review/infrastructure/repositories/review.repository.ts`                         | Broad but core persistence; watch interface breadth                 |
|   689 | `src/contexts/review/build.ts`                                                                 | Bounded wiring; materially smaller than Integration build           |
|   686 | `src/contexts/review/application/use-cases/reply-operations.ts`                                | Core reply lifecycle orchestration                                  |
|   677 | `src/contexts/review/application/use-cases/run-review-provider-snapshot.ts`                    | Core snapshot orchestration                                         |
|   657 | `src/contexts/review/infrastructure/repositories/review-observation.repository.ts`             | Justified observation persistence                                   |
|   640 | `src/contexts/review/domain/events.ts`                                                         | Core durable fact vocabulary; size reflects event catalogue breadth |

For one tenant, the highest-return deletion is not collapsing contexts: it is removing the duplicate SLA path, deleting inert Goal/Team product implementations, narrowing 488 unused boundary names, and replacing unclassified foreign-table reads with a small set of explicit projection/atomicity exceptions. That reduces false confidence and cognitive load without weakening tenant isolation or durable-work guarantees.

## Unverified / needs a runtime check

1. **Legacy deletion data:** run `pnpm ops:report-legacy-people-team` and `pnpm ops:report-legacy-recognition` against the production read-only connection, archive their exact count/FK fingerprints, then restore the Organization export into an isolated database. No reviewed output proving zero unexplained rows or restore completeness was located. Until then, all three schemas remain non-deletable.
2. **Actual SLA/Target divergence in the cohort:** query the Organization's `responseSlaHours` and Inbox target-policy rows, then compare Dashboard/Fleet unanswered IDs with active Inbox Google target IDs for all six Properties. Static reachability proves two authorities; this runtime comparison measures current user impact.
3. **Provider-state mismatch count:** count replies in local `published` state lacking an exact current live observation and current external-live observations without a local published row. Those are the two classes Dashboard currently misclassifies.
4. **Foreign-table exception intent:** the 84-import census establishes dependencies, not whether each was reviewed. Confirm atomicity/projection/export rationale file-by-file before moving one; an owner API is not automatically safer than a same-transaction query.
5. **One-container-per-process runtime isolation:** source shape and static graph are verified here; the independently constructed web/worker/sidecar fixture result was not rerun in this axis review.
6. **Public export dynamic consumers:** the 488 figure is “no named production import outside the defining context,” not proof of dead code. Before deletion, include scripts/services, dynamic imports, generated clients, and operator tooling in the final reachability scan.

## Opinion

The rewrite chose the right top-level shape: keep stable domain contexts, make dark capabilities truly dark, and use explicit cross-context facts. The remaining problem is that governance catalogues are sometimes compensating for code that has not been made small—especially barrels, foreign-table projections, and retained legacy implementations. At a one-tenant/six-property beta scale, delete those concrete sources of ambiguity before adding another catalogue or gate; preserve the transactional stores and security kernels whose complexity buys demonstrable correctness.
