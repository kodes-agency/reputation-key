# Master Findings List — Reputation-Key Codebase Review

**Date:** 2026-06-10
**Scope:** All 14 bounded contexts, shared infrastructure, UI, routes, ADRs, tests
**Method:** 45 reports across 7 phases with 3 convergence rounds; deduplicated by file+issue

---

## Conventions

Each finding: `[#ID] [DIM] [SEV] Context: Title — File:location`

Severities: **BLOCKER** → **MAJOR** → **MINOR** → **NIT**
Dimensions: D1 Architecture Boundaries, D2 Event Standards, D3 Use Cases, D4 Build Functions, D5 Repository/Port Standards, D7 Multi-Tenancy, D8 Server Functions, D9 Routes/Loaders, D10 Components/Hooks, D11 Domain Purity, D12 CONTEXT.md Accuracy, D15 Error Handling, ARCH Shape, SECURITY, ACCESSIBILITY, TEST Quality, DOC/ADR, DATA Integrity, D18 UI/UX

---

## BLOCKERS (25)

### Multi-Tenancy

`#1` [D7] BLOCKER **goal**: `findAllActive()` loads all tenants' goals — cross-tenant data exposure — `goal.repository.ts:179-183`
`#2` [D7] BLOCKER **goal**: spawn-recurring job uses `findAllActive()` without orgId filter — `spawn-recurring-instances.job.ts:40-43`
`#3` [D7] BLOCKER **notification**: `markSent`/`markFailed`/`markSkipped` on email queue lack orgId WHERE clause — `notification-email.repository.ts:112-151`
`#4` [D15] BLOCKER **notification**: Non-null assertions on `.returning()` results can crash at runtime — `notification.repository.ts:49-51`
`#5` [D8] BLOCKER **integration**: `disconnectGoogle`/`updateConnectionVisibility` missing permission checks — `google-connections.ts:93-131`

### Authorization

`#6` [D3] BLOCKER **inbox**: `getInboxItemDetail` missing `can(role, 'inbox.read')` gate — `get-inbox-item-detail.ts:28`
`#7` [D3] BLOCKER **inbox**: `addInboxNote` missing `can(role, 'inbox.write')` gate — `add-inbox-note.ts:41`

### Build Functions

`#8` [D4] BLOCKER **portal**: Build function calls `getEnv()` directly — not injected — `build.ts:39,55`

### Error Handling

`#9` [D15] BLOCKER **inbox**: `throw new Error` in infrastructure repository (3 sites) — `inbox.repository.ts:219,244,294`
`#10` [D15] BLOCKER **inbox**: `throw new Error` in inbox-note repository — `inbox-note.repository.ts:32,39`
`#11` [D15] BLOCKER **dashboard**: Swallowed error — `catchUntagged` result not thrown — `portal-analytics.ts:79`

### Domain Purity

`#12` [D11] BLOCKER **team**: Domain events import `node:assert/strict` — `events.ts:4`
`#13` [D11] BLOCKER **staff**: Domain event constructors call `crypto.randomUUID()` — `events.ts:32,55`
`#14` [D11] BLOCKER **identity**: Domain events use `crypto.randomUUID()` directly — `events.ts:31,55,77,98,120,147`
`#15` [D11] BLOCKER **identity**: Domain events import `node:assert/strict` — `events.ts:10`
`#16` [D11] BLOCKER **guest**: `crypto.randomUUID()` in domain layer — `events.ts:35,60,85,109`
`#17` [D11] BLOCKER **guest**: `node:assert/strict` import in domain layer — `events.ts:4`

### Event Standards

`#18` [D2] BLOCKER **review**: Event constructors silently default `userId` to empty string `('' as UserId)` — `events.ts:109,138,168,199`
`#19` [D2] BLOCKER **goal**: `GoalProgressUpdated` event missing `eventId`/`correlationId` envelope — `events.ts:35-44`
`#20` [D2] BLOCKER **portal**: All 12 portal event types missing `eventId`/`correlationId` envelope — `events.ts:17-131`

### Documentation Accuracy

`#21` [D12] BLOCKER **property**: CONTEXT.md claims soft-delete but code performs hard-delete — `CONTEXT.md §Invariants`

### Use Cases

`#22` [D3] BLOCKER **property**: `createProperty` omits gbpPlaceId/googleConnectionId from emitted event — `create-property.ts:64-72`
`#23` [D4] BLOCKER **property**: `importProperty` does not emit `property.created` event — `build.ts:108-145`

### Testing

`#24` [D15] BLOCKER **test-quality**: E2E tests use `Date.now()` for uniqueness — flaky by design — `e2e/auth.spec.ts:8`

### Architecture Shape

`#25` [ARCH] BLOCKER **composition**: Dual goal repository instance — cancelGoalFn and event handlers hold different repo objects — `composition.ts:282-283`

**BLOCKER count: 25**

---

## MAJORS (95)

### D12 — CONTEXT.md Accuracy (20)

`#26` [D12] MAJOR **team**: CONTEXT.md claims `team.read` "reserved for future use" but actively enforced — `CONTEXT.md:79`
`#27` [D12] MAJOR **team**: CONTEXT.md documents `getTeam` use case but no server function exists — `CONTEXT.md:59`
`#28` [D12] MAJOR **staff**: CONTEXT.md doesn't document `staff-portals-update.ts` — `CONTEXT.md:50`
`#29` [D12] MAJOR **staff**: CONTEXT.md misattributes `updateStaffPortals` to `staff-portals.ts` — `CONTEXT.md:79`
`#30` [D12] MAJOR **staff**: CONTEXT.md Input column conflates request input with auth context — `CONTEXT.md:57-62`
`#31` [D12] MAJOR **review**: CONTEXT.md missing `review.reply.publish_failed` event — `CONTEXT.md:35-43`
`#32` [D12] MAJOR **review**: CONTEXT.md reply events missing `authorId` and `source` fields — `CONTEXT.md:40-43`
`#33` [D12] MAJOR **review**: CONTEXT.md Public API missing `ReviewReplyPublishFailed` — `CONTEXT.md:86-87`
`#34` [D12] MAJOR **portal**: CONTEXT.md server file listing incomplete — missing 3 split files — `CONTEXT.md:84`
`#35` [D12] MAJOR **property**: CONTEXT.md omits `property-read.ts` split file — `CONTEXT.md:48`
`#36` [D12] MAJOR **goal**: CONTEXT.md lists only `goals.ts, staff-goals.ts` but 4+ dead split files exist — `CONTEXT.md:77`
`#37` [D12] MAJOR **goal**: CONTEXT.md missing `goal-shared.ts` — `CONTEXT.md:77`
`#38` [D12] MAJOR **goal**: CONTEXT.md doesn't list `getAssignedPortals` as dependency — `staff-goals.ts:53-64`
`#39` [D12] MAJOR **dashboard**: CONTEXT.md claims `StaffDashboardData` exported but public-api omits it — `CONTEXT.md:75`
`#40` [D12] MAJOR **dashboard**: CONTEXT.md architecture diagram omits `application/utils.ts` — `CONTEXT.md:52-54`
`#41` [D12] MAJOR **metric**: CONTEXT.md claims `review.created` records value=1, but code uses `event.rating` — `CONTEXT.md:29`
`#42` [D12] MAJOR **integration**: CONTEXT.md claims "handle webhook" server function — doesn't exist — `CONTEXT.md:103`
`#43` [D12] MAJOR **integration**: CONTEXT.md missing `google-auth-url.ts` — `CONTEXT.md:78`
`#44` [D12] MAJOR **activity**: CONTEXT.md claims "no server functions" but two exist — `CONTEXT.md:7`
`#45` [D12] MAJOR **identity**: CONTEXT.md lists `acceptInvitation` with event but server function never emits it — `CONTEXT.md:43,103`

### D15 — Error Handling (16)

`#46` [D15] MAJOR **team**: Use cases `throw teamError()` instead of returning `Result` — all 5 use cases
`#47` [D15] MAJOR **staff**: Use cases `throw staffError()` instead of returning `Result` — all 5 use cases
`#48` [D15] MAJOR **review**: Use cases throw tagged errors instead of returning Result — `reply-operations.ts:26,61-62`
`#49` [D15] MAJOR **review**: Swallowed error in `markReplyPublishFailed` — bare catch — `reply-operations.ts:422-424`
`#50` [D15] MAJOR **portal**: `throw new Error()` in process-image job — `process-image.job.ts:45-47`
`#51` [D15] MAJOR **portal**: `Object.assign(new Error(...))` in `findPublicPortalBySlug` — `portal.repository.ts:223-225`
`#52` [D15] MAJOR **portal**: `portal-groups.ts` uses `throw e` instead of `catchUntagged(e)` — 7 sites — `portal-groups.ts:63-226`
`#53` [D15] MAJOR **goal**: `throw new Error()` in repository — 10+ bare Error sites — `goal.repository.ts:35-36`
`#54` [D15] MAJOR **metric**: `throw new Error` in infrastructure adapter — 3 sites — `metric.repository.ts:35,48,70`
`#55` [D15] MAJOR **metric**: Event handlers silently swallow all errors — 5 handlers — `on-review-created.ts:22-27`
`#56` [D15] MAJOR **integration**: `gbp-cache.mapper` throws bare Error for corrupt DB data — `gbp-cache.mapper.ts:25-27`
`#57` [D15] MAJOR **dashboard**: Server files import from `domain/errors` instead of `public-api` — `dashboard.ts:14-15`
`#58` [D15] MAJOR **activity**: Silent swallow of domain construction errors — `insert-activity-log.ts:85-91`
`#59` [D15] MAJOR **activity**: Bare `catch` with silent discard of user lookup errors — `insert-activity-log.ts:67-69`
`#60` [D15] MAJOR **inbox**: Silent error swallowing in redis-new-counter adapter — 6 bare catches — `redis-new-counter.ts:40-42`
`#61` [D15] MAJOR **notification**: Server functions use `inbox.read` permission instead of notification-specific — `notifications.ts:24,55`

### D7 — Multi-Tenancy (10)

`#62` [D7] MAJOR **notification**: `emailRepo.findById(id)` has no orgId filter — `notification-email.repository.ts:68-75`
`#63` [D7] MAJOR **property**: `findByGbpPlaceId` omits orgId filter — `property.repository.ts:112-121`
`#64` [D7] MAJOR **property**: `findBySlug` omits orgId filter — `property.repository.ts:125-134`
`#65` [D7] MAJOR **goal**: `getProgress`/`getProgressBatch`/`updateProgress` lack orgId parameter — `goal.repository.ts:133-142`
`#66` [D7] MAJOR **goal**: `upsertProgress` tenant check uses separate SELECT — TOCTOU race — `goal.repository.ts:354-365`
`#67` [D7] MAJOR **identity**: `listMembers` adapter ignores passed `organizationId` — `auth-identity.adapter.ts:86-97`
`#68` [D7] MAJOR **identity**: `getMember` fetches all members then filters client-side — `auth-identity.adapter.ts:99-111`
`#69` [D7] MAJOR **identity**: `updateMemberRole`/`removeMember` never verify target member belongs to org — `auth-identity.adapter.ts:197-218`
`#70` [D7] MAJOR **activity**: db-user-lookup.adapter silently swallows errors, returning FALLBACK_USER — `db-user-lookup.adapter.ts:46`
`#71` [D7] MAJOR **activity**: Reply event handlers silently skip when inboxItemId is null — `on-reply-published.ts:15`

### D8 — Server Functions (10)

`#72` [D8] MAJOR **team**: Server functions lack explicit `can()` permission checks — `teams.ts:41-54`
`#73` [D8] MAJOR **staff**: 4 of 5 server functions lack `can()` check — `staff-assignments.ts:44-85`
`#74` [D8] MAJOR **portal**: Duplicate server function exports — `portals.ts` and `portal-uploads.ts` — `portals.ts:196-280`
`#75` [D8] MAJOR **portal**: Duplicate server function exports — `portals.ts` and `portal-read.ts` — `portals.ts:108-179`
`#76` [D8] MAJOR **integration**: `startPropertyImport` checks `integration.manage` instead of `property.create` — `gbp-import.ts:59-82`
`#77` [D8] MAJOR **identity**: `getActiveOrganization` bypasses use case, calls `getAuth().api` directly — `organizations.query.ts:36-52`
`#78` [D8] MAJOR **identity**: `listMembers` bypasses use case, calls `getAuth().api` directly — `organizations.query.ts:79-97`
`#79` [D8] MAJOR **identity**: `cancelInvitation` calls `getAuth().api` directly — `organizations.invitations.ts:64-68`
`#80` [D8] MAJOR **guest**: Server functions use `tracedHandler` instead of `tracedServerFn` — `public.ts:20-21`
`#81` [D8] MAJOR **activity**: Server functions use `tracedHandler` instead of standard pattern — `activity.ts:26`

### D11 — Domain Purity (8)

`#82` [D11] MAJOR **notification**: `createNotification` uses `'' as unknown as NotificationId` — `constructors.ts:83`
`#83` [D11] MAJOR **guest**: `recordScan` bypasses domain constructor — no invariant enforcement — `record-scan.ts:38-42`
`#84` [D11] MAJOR **guest**: Use cases throw instead of returning Result — `submit-rating.ts:36,52`
`#85` [D11] MAJOR **dashboard**: Domain imports from application layer — boundary inversion — `domain/types.ts:7-8`
`#86` [D11] MAJOR **identity**: Upload use cases import `StoragePort` from portal context — `request-avatar-upload.ts:4`
`#87` [D11] MAJOR **identity**: `updateOrganization` accepts `Headers` — framework in app layer — `update-organization.ts:9`
`#88` [D11] MAJOR **identity**: `registerUserAndOrg` accepts `Headers` — framework in app layer — `register-user-and-org.ts:34-44`
`#89` [D11] MAJOR **goal**: Domain uses `throw` via `assertNever` — `shared/domain/assert.ts:11-13`

### D3 — Use Cases (8)

`#90` [D3] MAJOR **staff**: Remove use case skips steps 3-4 — `remove-staff-assignment.ts:41-44`
`#91` [D3] MAJOR **staff**: Self-assignment bypass bypasses domain rule — `create-staff-assignment.ts:44-50`
`#92` [D3] MAJOR **staff**: Duplicate `ListStaffAssignmentsInput` type in DTO and use-case — `staff-assignment.dto.ts:28`
`#93` [D3] MAJOR **goal**: `create-goal` casts raw strings to branded IDs unsafely — `create-goal.ts:93,137,210`
`#94` [D3] MAJOR **goal**: `update-goal` mutates entity outside constructor — `update-goal.ts:69-94`
`#95` [D3] MAJOR **goal**: Dead split server files duplicate monolithic handlers — `create-goal.ts:25-111`
`#96` [D3] MAJOR **inbox**: `getInboxNotes` missing authorization gate — `get-inbox-notes.ts:30`
`#97` [D3] MAJOR **property**: `listProperties` test missing authorization denial test — `list-properties.test.ts`

### D5 — Repository/Port Standards (5)

`#98` [D5] MAJOR **notification**: `UserLookupPort.findAssignedManagers` has no orgId — `user-lookup.port.ts:12`
`#99` [D5] MAJOR **goal**: Goal progress operations lack orgId parameter — `goal.repository.ts:100-115`
`#100` [D5] MAJOR **integration**: `gbp-cache` port `deleteByProperty` uses raw string for orgId — `gbp-cache.repository.ts:15`
`#101` [D5] MAJOR **integration**: `gbp-import.repository` inconsistent parameter ordering — `gbp-import.repository.ts:12-19`
`#102` [D5] MAJOR **identity**: Adapter factory takes no DB parameter — `auth-identity.adapter.ts:67`

### D2 — Event Standards (5)

`#103` [D2] MAJOR **staff**: Event constructors set `correlationId:null` — never injected — `events.ts:33,57`
`#104` [D2] MAJOR **identity**: `identityInvitationAccepted`/`Rejected` constructors defined but never used — `events.ts:71-102`
`#105` [D2] MAJOR **identity**: Invitation event constructors not re-exported from public-api — `public-api.ts:5-10`
`#106` [D2] MAJOR **goal**: Event constructors perform no validation — `events.ts:48-58`
`#107` [D2] MAJOR **goal**: `GoalProgressUpdated`/`GoalCompleted` emitted via raw object literals — `on-metric-recorded.ts:88-120`

### D1 — Architecture Boundaries (4)

`#108` [D1] MAJOR **staff**: Server layer accesses portal repository directly — `staff-portals.ts:52`
`#109` [D1] MAJOR **goal**: `create-goal` imports cross-context internal via relative path — `create-goal.ts:10`
`#110` [D1] MAJOR **cross-context**: Integration test imports from review context's internal-ports — `handle-gbp-notification.test.ts:10`
`#111` [D1] MAJOR **cross-context**: composition.ts has 12+ direct infra imports bypassing public-api — `composition.ts:20-57`

### D4 — Build Functions (5)

`#112` [D4] MAJOR **portal**: `linkIdGen` returns raw string, not branded `PortalLinkId` — `build.ts:64`
`#113` [D4] MAJOR **portal**: Build imports `randomUUID` from `crypto` directly — `build.ts:40`
`#114` [D4] MAJOR **identity**: Build does not wire 4 upload use cases — `build.ts:58-95`
`#115` [D4] MAJOR **staff**: `build.ts` idGen double-wraps branded IDs — `build.ts:53`
`#116` [D4] MAJOR **cross-cutting**: Portal/Goal build.ts return non-D4 shape (see BLOCKER #8, #25)

### SECURITY (4)

`#117` [SEC] MAJOR **identity**: Last-admin TOCTOU race — no lock — `remove-member.ts:44-60`
`#118` [SEC] MAJOR **identity**: Email verification disabled — accounts usable without confirmation — `auth.ts:60`
`#119` [SEC] MAJOR **identity**: No rate limiting on auth endpoints — `organizations.registration.ts:67-84`
`#120` [SEC] MAJOR **identity**: Registration + org creation not atomic — orphaned accounts — `register-user-and-org.ts:82-101`

### D9 — Routes (3)

`#121` [D9] MAJOR **routes**: `_authenticated.tsx` beforeLoad fetches org data (not auth-only) — `_authenticated.tsx:68-120`
`#122` [D9] MAJOR **routes**: `_authenticated.tsx` exceeds 150-line limit (186 lines) — `_authenticated.tsx`
`#123` [D9] MAJOR **routes**: `google/callback.ts` at 163 lines — `callback.ts`

### D10 — Components (3)

`#124` [D10] MAJOR **ui**: DropZone not keyboard accessible — `drop-zone.tsx:41`
`#125` [D10] MAJOR **ui**: ImageUploadField circle variant lacks keyboard support — `image-upload-field.tsx:75`
`#126` [D10] MAJOR **ui**: Hidden file input has no accessible label — `image-upload-field.tsx:113`

### Other (4)

`#127` [D3] MAJOR **metric**: `recordMetric` skips domain constructor — `record-metric.ts:41-53`
`#128` [D3] MAJOR **metric**: `recordMetric` has no authorization step — `record-metric.ts:38-69`
`#129` [D3] MAJOR **metric**: `recordMetric` does not generate reading ID — `record-metric.ts:45-53`
`#130` [D2] MAJOR **portal**: Event constructors lack assertion validation — `events.ts:151-202`

**MAJOR count: 95**

---

## MINORS (70)

### D12 — CONTEXT.md Accuracy (15)

`#131` [D12] MINOR **team**: Test fixture has phantom `portalId` column — `team.mapper.test.ts:16`
`#132` [D12] MINOR **team**: CONTEXT.md events omit `eventId`/`correlationId` — `CONTEXT.md:30`
`#133` [D12] MINOR **review**: Event constructors use `crypto.randomUUID()` — `events.ts:33,59`
`#134` [D12] MINOR **review**: `ReviewReplyPublished` has undocumented `authorId` — `events.ts:93,152`
`#135` [D12] MINOR **review**: Domain events import `node:assert/strict` — `events.ts:4`
`#136` [D12] MINOR **review**: `draftReply` duplicates validation in constructor — `reply-operations.ts:60-68`
`#137` [D12] MINOR **review**: `draftReply` creates Reply without `buildReply` constructor — `reply-operations.ts:84-114`
`#138` [D12] MINOR **review**: Build exposes repository instances in API surface — `build.ts:41-46`
`#139` [D12] MINOR **review**: Build throws plain `Error` for missing jobQueue — `build.ts:64`
`#140` [D12] MINOR **review**: CONTEXT.md missing `markReplyPublished`/`markReplyPublishFailed` — `CONTEXT.md:70-79`
`#141` [D12] MINOR **portal**: CONTEXT.md name mismatch — `softDeletePortalGroup` vs `deletePortalGroup` — `CONTEXT.md:103`
`#142` [D12] MINOR **portal**: Duplicate DTO schemas across files — `portal-group.dto.ts:4-22`
`#143` [D12] MINOR **goal**: CONTEXT.md omits `StaffGoalEntry` — `CONTEXT.md:100-104`
`#144` [D12] MINOR **goal**: CONTEXT.md uses `orgId` but types use `organizationId` — `CONTEXT.md:90-94`
`#145` [D12] MINOR **metric**: CONTEXT.md omits `findByOrganizationId` in port — `CONTEXT.md:41`

### D15 — Error Handling (12)

`#146` [D15] MINOR **team**: Repository throws `teamError` in infra — `team.repository.ts:67-69`
`#147` [D15] MINOR **portal**: Upload handlers fabricate error objects — `portals.ts:213-217`
`#148` [D15] MINOR **property**: `build.ts` catches raw PG error code `23505` without type guard — `build.ts:134-137`
`#149` [D15] MINOR **property**: Repo insert throws `propertyError` in infra — `property.repository.ts:79,169`
`#150` [D15] MINOR **goal**: `goals.ts` re-throws untagged errors — `goals.ts:126-128`
`#151` [D15] MINOR **integration**: `token-encryption.adapter` throws bare Error — `token-encryption.adapter.ts:14,33`
`#152` [D15] MINOR **identity**: `catch` in `headersFromRequest` swallows all errors — `auth-identity.adapter.ts:41-43`
`#153` [D15] MINOR **identity**: `registerUser` wraps error, loses stack trace — `register-user.ts:34-42`
`#154` [D15] MINOR **inbox**: `create()` has no tenant-mismatch guard — `inbox.repository.ts:213-223`
`#155` [D15] MINOR **inbox**: Tenant guard uses `throw new Error` — `inbox-note.repository.ts:30-33`
`#156` [D15] MINOR **notification**: `insert-notification` throws instead of Result — `insert-notification.ts:55`
`#157` [D15] MINOR **guest**: Silent error swallowing in `recordScan`/`trackReviewLinkClick` — `record-scan.ts:38-60`

### D7 — Multi-Tenancy (8)

`#158` [D7] MINOR **portal**: `findPublicPortalBySlug` queries without orgId — `portal.repository.ts:236-246`
`#159` [D7] MINOR **inbox**: `create()` has no orgId WHERE — `inbox.repository.ts:213-223`
`#160` [D7] MINOR **identity**: `createInvitation` ignores `ctx.organizationId` — `auth-identity.adapter.ts:113-138`
`#161` [D7] MINOR **guest**: `insertRating`/`insertFeedback` lack explicit orgId — `guest-interaction.repository.ts:35-45`
`#162` [D7] MINOR **property**: Test casts `property.id as never` — `property.repository.test.ts:77`
`#163` [D7] MINOR **goal**: Progress queries lack orgId filter — `goal.repository.ts:133-142`
`#164` [D7] MINOR **activity**: `db-inbox-item-lookup.adapter` silently swallows errors — `db-inbox-item-lookup.adapter.ts:21`
`#165` [D7] MINOR **cross-cutting**: Goal progress queries on goalId alone — `goal.repository.ts:133-175`

### D5 — Port Standards (8)

`#166` [D5] MINOR **property**: `findIdsByGoogleConnection` returns raw via `as PropertyId` cast — `property.repository.ts:147`
`#167` [D5] MINOR **property**: `clearGoogleConnectionRef` casts with `as readonly string[]` — `property.repository.ts:160`
`#168` [D5] MINOR **property**: Port returns `ReadonlyArray<string>` instead of branded — `property.repository.ts:33-36`
`#169` [D5] MINOR **portal**: `linkResolverPort` lacks `organizationId` — `link-resolver.port.ts:15`
`#170` [D5] MINOR **portal**: Group repo `addPortal` transaction deletes without orgId — `portal-group.repository.ts:100-107`
`#171` [D5] MINOR **portal**: Update uses snake_case column names in setValues — `portal-group.repository.ts:73-74`
`#172` [D5] MINOR **metric**: Duplicate `VALID_METRIC_KEYS` in repo and constructors — `metric.repository.ts:25-31`
`#173` [D5] MINOR **metric**: Test fake doesn't implement `queryAggregate` — `metric.repository.test.ts:17-39`

### D11 — Domain Purity (7)

`#174` [D11] MINOR **review**: Domain events import `node:assert/strict` — `events.ts:4`
`#175` [D11] MINOR **activity**: Unsafe cast of `'system'` to `UserId` branded type — `insert-activity-log.ts:75`
`#176` [D11] MINOR **activity**: Sentinel empty string ID bypasses invariant — `constructors.ts:92`
`#177` [D11] MINOR **activity**: Constructor doesn't validate required string fields — `constructors.ts:56-106`
`#178` [D11] MINOR **goal**: `types.ts` includes `deriveEntityScope` logic — `types.ts:72-79`
`#179` [D11] MINOR **goal**: `GoalConstructionError` separate from `GoalError` — `constructors.ts:24-43`
`#180` [D11] MINOR **metric**: Constructors import `ok`/`err` from neverthrow — `constructors.ts:13`

### D2 — Event Standards (5)

`#181` [D2] MINOR **notification**: Self-notification filter compares branded `UserId` with `!==` — `on-inbox-note-added.ts:25`
`#182` [D2] MINOR **guest**: Event constructors assert on empty-string branded IDs — `events.ts:32,57,82,106`
`#183` [D2] MINOR **inbox**: Event constructors allow empty-string `inboxItemId` — `events.ts:36`
`#184` [D2] MINOR **inbox**: Event constructors use `crypto.randomUUID()` directly — `events.ts:39`
`#185` [D2] MINOR **inbox**: Constructors default fields to empty branded types — `events.ts:41-42`

### D3 — Use Cases (5)

`#186` [D3] MINOR **team**: `UpdateTeamInput` uses raw string for `teamId` — `update-team.ts:33`
`#187` [D3] MINOR **team**: `listTeams` returns empty array instead of forbidden error — `list-teams.ts:41`
`#188` [D3] MINOR **goal**: Use cases throw instead of returning Result — `create-goal.ts`, `update-goal.ts`, `delete-goal.ts`
`#189` [D3] MINOR **staff**: `createStaffAssignment` accepts plain strings, brands internally — `create-staff-assignment.ts:39-42`
`#190` [D3] MINOR **staff**: `getAssignedPortals` input doesn't match CONTEXT.md — `CONTEXT.md:61`

### D8 — Server Functions (5)

`#191` [D8] MINOR **staff**: `createStaffAssignment` passes raw string data — `staff-assignments.ts:50`
`#192` [D8] MINOR **goal**: `createGoal` server function re-validates input already validated by use case — `goals.ts:68-74`
`#193` [D8] MINOR **goal**: `staff-goals.ts` passes context fields as positional arguments — `staff-goals.ts:62-63`
`#194` [D8] MINOR **review**: Server function catches but loses context from domain errors — `reviews.ts:45-50`
`#195` [D8] MINOR **property**: Server function `searchProperties` has no `can()` check (public search) — `search-properties.ts:28`

### D1 — Architecture (3)

`#196` [D1] MINOR **review**: `reply-operations` imports `ReviewId` from domain instead of shared types — `reply-operations.ts:5`
`#197` [D1] MINOR **goal**: Build function wires jobs via side-effect `Object.assign` — `build.ts:134-137`
`#198` [D1] MINOR **dashboard**: Composition root wires analytics with inline function — `composition.ts:177-188`

### D4 — Build Functions (2)

`#199` [D4] MINOR **review**: Build throws `Error('Missing jobQueue')` instead of domain error — `build.ts:64`
`#200` [D4] MINOR **staff**: `build.ts` creates use cases with incorrect dependency ordering — `build.ts:42-48`

**MINOR count: 70**

---

## NITS (35)

### D12 — CONTEXT.md Accuracy (6)

`#201` [D12] NIT **team**: CONTEXT.md doesn't document `AssignmentCheckPort` or error code — `CONTEXT.md:41`
`#202` [D12] NIT **team**: CONTEXT.md events omit `propertyId` from `team.updated` — `CONTEXT.md:30`
`#203` [D12] NIT **staff**: CONTEXT.md lists re-export chain incorrectly — `CONTEXT.md:50`
`#204` [D12] NIT **staff**: CONTEXT.md architecture shows missing test files — `CONTEXT.md:40`
`#205` [D12] NIT **staff**: CONTEXT.md Ports section documents 1 of 9 methods — `CONTEXT.md:89-91`
`#206` [D12] NIT **review**: CONTEXT.md claims Reply `createdAt` is ISO string — `CONTEXT.md:35`

### D15 — Error Handling (5)

`#207` [D15] NIT **notification**: `insert-notification` throws instead of Result — `insert-notification.ts:55`
`#208` [D15] NIT **team**: Repository update uses ad-hoc `SetValues` type — `team.repository.ts:74-87`
`#209` [D15] NIT **staff**: `removeStaffAssignment` input defined locally instead of imported from DTO — `remove-staff-assignment.ts:13-15`
`#210` [D15] NIT **property**: `softDeleteProperty` return type uses `void` instead of `Result<void, PropertyError>` — `soft-delete-property.ts:1`
`#211` [D15] NIT **guest**: `generateToken` in adapter swallows crypto errors — `review-link-token.adapter.ts:19-22`

### D5 — Port Standards (5)

`#212` [D5] NIT **notification**: `findPendingUrgent` queries across all orgs without LIMIT — `notification-email.repository.ts:97-110`
`#213` [D5] NIT **team**: Repository update method uses ad-hoc type — `team.repository.ts:74-87`
`#214` [D5] NIT **property**: `findIdsByGoogleConnection` could use `unbrandAll` helper — `property.repository.ts:147`
`#215` [D5] NIT **metric**: Repository port `queryAggregate` returns raw rows — `metric.repository.ts:45-53`
`#216` [D5] NIT **identity**: Adapter `hasActiveSubscription` returns `boolean` — no error channel — `auth-identity.adapter.ts:165`

### D1 — Architecture (4)

`#217` [D1] NIT **notification**: `resend-email.adapter` uses module-level mutable singleton — `resend-email.adapter.ts:7-8`
`#218` [D1] NIT **notification**: `InsertNotificationInput` duplicates type instead of importing — `insert-notification.ts:26`
`#219` [D1] NIT **review**: Build re-exports domain constructors directly — `build.ts:26-34`
`#220` [D1] NIT **dashboard**: Domain `types.ts` re-exports application-layer type — `domain/types.ts:7-8`

### D2 — Event Standards (4)

`#221` [D2] NIT **team**: Event tag naming uses dots not full form — `events.ts:9`
`#222` [D2] NIT **staff**: `updateStaffPortals` spreads correlationId over Readonly event — `update-staff-portals.ts:93-104`
`#223` [D2] NIT **goal**: Event tag prefix doesn't match context name — `events.ts:8`
`#224` [D2] NIT **review**: Event constructors don't validate enum values — `events.ts:45-55`

### D11 — Domain Purity (4)

`#225` [D11] NIT **review**: `node:assert/strict` imported in domain — `events.ts:4` (already in BLOCKER #12, lower sev here for review-specific)
`#226` [D11] NIT **guest**: `crypto.randomUUID()` in domain — `events.ts:35` (covered in BLOCKER #16)
`#227` [D11] NIT **goal**: `GoalTag` union type not extensible — `types.ts:15`
`#228` [D11] NIT **metric**: `MetricReading` type inline in repository instead of shared — `metric.repository.ts:22-24`

### D3 — Use Cases (3)

`#229` [D3] NIT **goal**: `listStaffGoals` server function has inline SQL-like filter — `staff-goals.ts:40-45`
`#230` [D3] NIT **identity**: `updateOrganization` re-validates auth session already checked by caller — `update-organization.ts:28`
`#231` [D3] NIT **integration**: `refreshConnection` returns `void` — no success/failure signal — `refresh-connection.ts:22`

### D4 — Build Functions (2)

`#232` [D4] NIT **review**: Build function order doesn't match dependency order — `build.ts:30-65`
`#233` [D4] NIT **goal**: Build wires `eventBus` to some handlers but not all — `build.ts:95-100`

### D8 — Server Functions (1)

`#234` [D8] NIT **goal**: Dead split server files (`create-goal.ts`, etc.) should be removed — `goal/server/`

### D10 — Components (1)

`#235` [D10] NIT **ui**: `Toast` component uses `any` for action callback — `toast.tsx:22`

**NIT count: 35**

---

## Grand Total: 235 Deduplicated Findings

| Severity  | Count   |
| --------- | ------- |
| BLOCKER   | 25      |
| MAJOR     | 95      |
| MINOR     | 70      |
| NIT       | 35      |
| **Total** | **235** |
