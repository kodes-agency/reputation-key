# Code Review #5: Infrastructure Adapters

## Findings

### [MAJOR] GBP notification handler uses Service Locator anti-pattern

**File:** `src/contexts/integration/infrastructure/handlers/gbp-notification-handler.ts:21`

```
const container = getContainer()
const result = await container.useCases.handleGbpNotification(input)
```

**Rule:** Adapters should receive dependencies via factory function, not pull from global container.
**Fix:** Convert to factory pattern accepting `handleGbpNotification` use case as a dep, matching all other infrastructure handlers in the codebase. Wire in composition.ts.

---

### [MAJOR] Goal on-metric-recorded handler defines local EventBus type instead of importing shared

**File:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:63-65`

```
export type EventBus = Readonly<{
  emit(event: GoalCompletedEvent | GoalProgressUpdatedEvent): Promise<void>
}>
```

**Rule:** Shared abstractions should be imported, not redefined locally.
**Fix:** Import the EventBus type from `#/shared/events/event-bus` and define only the event types locally.

---

### [MINOR] Unsafe cross-brand cast between StaffAssignmentId and StaffId

**File:** `src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.ts:30`

```
staffId: event.assignmentId as unknown as StaffId,
```

**Rule:** Branded IDs exist to prevent exactly this kind of cross-type substitution.
**Fix:** Either add a conversion helper in `#/shared/domain/ids` or confirm the domain model that StaffAssignmentId and StaffId represent the same underlying value and remove the double-cast with a documented helper.

---

### [MINOR] Portal link repository uses untyped `Record<string, unknown>` for update sets

**File:** `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts:90,131`

```
const setValues: Record<string, unknown> = {}
```

**Rule:** Other repositories use explicit `SetValues` types for type-safe updates.
**Fix:** Define explicit `CategorySetValues` and `LinkSetValues` types matching the pattern in portal.repository.ts.

---

### [MINOR] Adapter class named `createGoogleReviewApiAdapter` — uses port-ish naming

**File:** `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts`
**Rule:** Adapters should be named after the technology (e.g., `createGaxiosReviewAdapter`), not the port they implement.
**Fix:** Rename to `createGbpReviewAdapter` for clarity.

---

## Clean Patterns Confirmed ✓

- **No `process.env` access** in any infrastructure file — all config goes through `getEnv()` in shared/config
- **No secrets at module scope** — encryption key passed as constructor parameter
- **OAuth tokens encrypted** with AES-256-GCM via `token-encryption.adapter.ts`
- **No SQL string interpolation** — all queries use Drizzle ORM or parameterized `sql` template literals
- **All multi-tenant queries** include `organizationId` in WHERE clause via `baseWhere()` helper
- **No tech types leaked** in return values — all adapters return domain types through mappers
- **No `console.log`** — all logging goes through `getLogger()` from shared observability
- **No mutable module-level state** — all use factory function pattern

---

## Ports → Adapters Mapping

| Context         | Port                         | Adapter                                           | Bound in composition.ts |
| --------------- | ---------------------------- | ------------------------------------------------- | ----------------------- |
| **dashboard**   | DashboardRepository          | createDashboardRepository                         | ✓                       |
| **goal**        | GoalRepository               | createGoalRepository                              | ✓                       |
| **guest**       | GuestInteractionRepository   | createGuestInteractionRepository                  | ✓                       |
|                 | PortalContextResolverPort    | createPortalContextResolver                       | ✓                       |
|                 | PublicPortalLookupPort       | createPublicPortalLookup                          | ✓                       |
| **identity**    | IdentityPort                 | createBetterAuthIdentityAdapter                   | ✓                       |
| **inbox**       | InboxRepository              | createInboxRepository                             | ✓                       |
|                 | InboxNoteRepository          | createInboxNoteRepository                         | ✓                       |
|                 | UnreadCounterPort            | createRedisUnreadCounter                          | ✓                       |
| **integration** | GbpApiPort                   | createGbpApiAdapter                               | ✓                       |
|                 | GoogleOAuthPort              | createGoogleOAuthAdapter                          | ✓                       |
|                 | TokenEncryptionPort          | createTokenEncryptionAdapter                      | ✓                       |
|                 | PropertyEventPort            | createPropertyEventAdapter                        | ✓                       |
|                 | GoogleConnectionRepository   | createGoogleConnectionRepository                  | ✓                       |
|                 | GbpCacheRepository           | createGbpCacheRepository                          | ✓                       |
|                 | GbpImportRepository          | createGbpImportRepository                         | ✓                       |
|                 | PropertyImportRepositoryPort | createPropertyImportRepository                    | ✓                       |
|                 | PropertyLookupPort           | inline adapter delegating to `property.publicApi` | ✓                       |
| **metric**      | MetricRepository             | createMetricRepository                            | ✓                       |
| **portal**      | PortalRepository             | createPortalRepository                            | ✓                       |
|                 | PortalLinkRepository         | createPortalLinkRepository                        | ✓                       |
|                 | LinkResolverPort             | createLinkResolverPort                            | ✓                       |
|                 | StoragePort                  | createS3StorageAdapter                            | ✓                       |
| **property**    | PropertyRepository           | createPropertyRepository                          | ✓                       |
| **review**      | ReviewRepository             | createReviewRepository                            | ✓                       |
|                 | ReplyRepository              | createReplyRepository                             | ✓                       |
|                 | GoogleReviewApiPort          | createGoogleReviewApiAdapter                      | ✓                       |
|                 | ReviewQueuePort              | BullMQ queue                                      | ✓                       |
|                 | ReplyQueuePort               | BullMQ queue                                      | ✓                       |
| **staff**       | StaffAssignmentRepository    | createStaffAssignmentRepository                   | ✓                       |
| **team**        | TeamRepository               | createTeamRepository                              | ✓                       |

**All ports have adapters. All adapters bound in composition.ts.**

---

## Summary

- **0 BLOCKERs**
- **2 MAJORs** (service locator in GBP handler, duplicated EventBus type)
- **3 MINORs** (unsafe brand cast, untyped update sets, naming)
- **33 port→adapter bindings** verified across 12 contexts

**Most important fix:** Replace service locator in `gbp-notification-handler.ts` with factory pattern.
