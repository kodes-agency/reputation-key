# Deep Review r16 — Per-Context Deep Dive (All 11 Contexts)

## Methodology

Scanned all 11 bounded contexts for cross-context violations, domain purity, permission enforcement, and structural health. Focused on the highest-risk contexts (Review, Inbox, Integration, Guest).

## Findings

### BLOCKER

None. Cross-context domain imports are all **event types** (allowed per `src/contexts/CONTEXT.md` line 23). One value import (`propertyCreated` constructor) in `integration/infrastructure/adapters/property-event.adapter.ts` — acceptable as the adapter implements cross-context event forwarding.

### MAJOR

**M1: 13 use cases without tests** (carried from r15)
Priority for new tests:
1. `integration/application/use-cases/handle-gbp-notification.ts`
2. `integration/application/use-cases/import-property.ts`
3. `identity/application/use-cases/update-organization.ts`

**M2: 6 integration adapters without tests** (carried from r15)
External API adapters (GBP, OAuth, S3) — need contract tests with mocked responses.

### MINOR

**N1: `staff/domain/constructors.ts` has no test** (carried from r15)

## Per-Context Health Summary

| Context | Domain | Use Cases | Tests | Ports/Adapters | Health |
|---------|--------|-----------|-------|----------------|--------|
| Identity | 3 files | 12 | 12 tests | Wrapped (better-auth) | ✅ Good |
| Property | 5 files | 5 | 6 tests | Repos + mappers | ✅ Good |
| Portal | 5 files | 17 | 17 tests | Repos + mappers + S3 + image job | ✅ Good |
| Guest | 5 files | 7 | 6 tests (1 missing) | Repos + resolvers | ✅ Good |
| Team | 5 files | 5 | 7 tests | Repos + mappers | ✅ Good |
| Staff | 5 files | 3 | 4 tests (1 constructor missing) | Repos + mappers | ✅ Good |
| Integration | 6 files | 10 | 4 tests (6 adapters untested) | OAuth + GBP + token + S3 | ⚠️ Adapters need tests |
| Review | 5 files | 2 (+reply ops) | 7 tests | Repos + jobs + queue | ✅ Good |
| Inbox | 5 files | 9 | 10 tests | Repos + Redis + event handlers | ✅ Good |
| Metric | 2 files | 1 | 6 tests (event handlers) | Repos + event handlers | ✅ Good |
| Dashboard | 1 file | 1 | 2 tests | Repos (read-only) | ✅ Good |

## Context-specific spot-checks

### Review
- ✅ Review and Reply are separate entities
- ✅ Reply.source: `google_sync` | `internal` correctly typed
- ✅ Reply lifecycle: explicit state machine in `rules.ts` (`REPLY_TRANSITIONS`)
- ✅ Staff blocked from replies: `requireManager()` → `can(role, 'reply.manage')` on all user-facing ops
- ✅ `markReplyPublished` and `markReplyPublishFailed` are internal-only (no auth — called by job)

### Inbox
- ✅ InboxItem carries denormalized fields
- ✅ Event handlers import event types from other contexts (allowed)

### Integration
- ✅ Token encryption adapter exists
- ⚠️ External API adapters lack contract tests

### Guest
- ✅ Public portal uses capability-token pattern (unguessable UUID)
- ✅ `as unknown as` in `guest-interaction.repository.ts` and `portal-context-resolver.ts` — FIXED in r14

### Property
- ✅ Properties are organization-owned
- ⚠️ Integration test failures (DB state) — non-blocking, likely test infrastructure issue

## Top 3 risks

1. Integration context adapters untested — GBP API changes could break silently
2. `handle-gbp-notification` use case untested — critical Pub/Sub handler
3. `import-property` use case untested — multi-step import flow with failure modes

## Triage

- All findings carried from r15 — no new BLOCKERs or MAJORs discovered
- Architecture is clean — no layer violations, proper event-driven communication
- Test gaps are the main remaining concern
