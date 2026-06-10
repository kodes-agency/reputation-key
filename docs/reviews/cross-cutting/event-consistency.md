# Event System Consistency Review

**Date:** 2026-06-10
**Scope:** All 12 context event definitions + shared master union
**Contexts reviewed:** identity, property, team, staff, portal, guest, integration, review, inbox, goal, metric, notification (notification = consumer only), dashboard (no events)

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 4      |
| MAJOR     | 8      |
| MINOR     | 5      |
| NIT       | 2      |
| **Total** | **19** |

---

## Findings

### BLOCKER

#### B1 — InboxEvent subtypes missing from shared DomainEvent union

**EventConsistency** BLOCKER Inbox has 7 event types but only 3 are exported to shared union
File: src/shared/events/events.ts:124-133
Quote:

```
export type {
  InboxEvent,
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemAssigned,
} from '#/contexts/inbox/domain/events'
```

Rule: standards.md §1 — "The master DomainEvent union is in shared/events/events.ts"
Fix: Export all 7 inbox subtypes: `InboxItemEscalated`, `InboxItemUnassigned`, `InboxNoteAdded`, `InboxItemBulkStatusChanged` from shared/events/events.ts. The `InboxEvent` union already includes them, so the master `DomainEvent` union technically covers them via `InboxEvent`, but the explicit re-exports are incomplete — any handler that pattern-matches on individual subtypes imported from shared won't find these 4.

#### B2 — Review event subtypes missing from shared re-exports

**EventConsistency** BLOCKER Review defines 8 events but only 5 are re-exported from shared
File: src/shared/events/events.ts:108-121
Quote:

```
export type {
  ReviewEvent,
  ReviewCreated,
  ReviewUpdated,
  ReviewExpired,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
} from '#/contexts/review/domain/events'
```

Rule: standards.md §1 — complete re-export of all event types in shared barrel
Fix: Add `ReviewReplySubmitted`, `ReviewReplyApproved`, `ReviewReplyRejected` to the shared re-exports. These 3 events are actively emitted and consumed (by activity, inbox, and notification handlers).

#### B3 — GoalProgressUpdated missing eventId and correlationId envelope fields

**EventConsistency** BLOCKER GoalProgressUpdated lacks required envelope fields
File: src/contexts/goal/domain/events.ts:35-44
Quote:

```
export type GoalProgressUpdated = Readonly<{
  _tag: 'goal.progress_updated'
  goalId: GoalId
  organizationId: OrganizationId
  metricKey: MetricKey
  previousValue: number
  currentValue: number
  computedSource: ComputedSource
  occurredAt: Date
}>
```

Rule: standards.md §1 — "All events carry eventId, occurredAt, correlationId"
Fix: Add `eventId: string` and `correlationId: string | null` to the type definition. The constructor must generate these. The raw emit in `on-metric-recorded.ts:88` also bypasses the constructor and omits these fields.

#### B4 — All portal events missing eventId and correlationId envelope fields

**EventConsistency** BLOCKER All 12 portal event types lack eventId and correlationId
File: src/contexts/portal/domain/events.ts:17-131
Quote:

```
export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>
```

Rule: standards.md §1 — "All events carry eventId, occurredAt, correlationId"
Fix: Add `eventId: string` and `correlationId: string | null` to all 12 portal event type definitions. Update constructors to generate `eventId: crypto.randomUUID()` and `correlationId: null`. Also add `assert(args.occurredAt instanceof Date, ...)` validation to constructors (currently missing).

---

### MAJOR

#### M1 — IntegrationPropertyImportCompleted defined but never emitted

**EventConsistency** MAJOR Orphan event: IntegrationPropertyImportCompleted has constructor + tests but no emission site
File: src/contexts/integration/domain/events.ts:52-74
Quote:

```
export type IntegrationPropertyImportCompleted = Readonly<{
  _tag: 'integration.property_import.completed'
  ...
}>
```

Rule: 4-layer consistency — event must be emitted by at least one use case or handler
Fix: Either emit from the property import job/use case, or remove the event type and constructor. The event has full test coverage but is dead code.

#### M2 — IdentityInvitationAccepted and IdentityInvitationRejected never emitted

**EventConsistency** MAJOR Orphan events: 2 identity event types have constructors but no emission sites
File: src/contexts/identity/domain/events.ts:61-102
Quote:

```
export type IdentityInvitationAccepted = Readonly<{
  _tag: 'identity.invitation.accepted'
  ...
}>
export type IdentityInvitationRejected = Readonly<{
  _tag: 'identity.invitation.rejected'
  ...
}>
```

Rule: 4-layer consistency — event must be emitted by at least one use case or handler
Fix: These are documented as "future use" but are exported in the `IdentityEvent` union and shared barrel. Either implement the invitation accept/reject flows that emit these, or remove from the union until implemented. The note in the file header is good, but they still inflate the DomainEvent union with unreachable types.

#### M3 — GoalProgressUpdated emitted via raw object literal, bypassing constructor

**EventConsistency** MAJOR GoalProgressUpdated emit skips constructor, omits envelope fields
File: src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:88-97
Quote:

```
await eventBus.emit({
  _tag: 'goal.progress_updated',
  goalId: goal.id,
  organizationId: goal.organizationId,
  metricKey: goal.metricKey,
  previousValue,
  currentValue: result.currentValue,
  computedSource: 'event_increment',
  occurredAt: now,
})
```

Rule: standards.md §1 — events must be emitted through constructors
Fix: Import and call `goalProgressUpdated({...})` instead of emitting a raw object. The constructor exists but is unused.

#### M4 — GoalCompleted emitted via raw object literal, bypassing constructor

**EventConsistency** MAJOR GoalCompleted emit in handler skips constructor
File: src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:103-120
Quote:

```
await eventBus.emit({
  _tag: 'goal.completed',
  eventId: crypto.randomUUID(),
  correlationId: null,
  ...
})
```

Rule: standards.md §1 — events must be emitted through constructors
Fix: Import and call `goalCompleted({...})` instead of hand-building the event object. The manual `crypto.randomUUID()` call should be inside the constructor, not at the call site.

#### M5 — Portal event constructors lack validation (no assert on occurredAt)

**EventConsistency** MAJOR All 12 portal constructors pass through args without validation
File: src/contexts/portal/domain/events.ts:151-202
Quote:

```
export const portalCreated = (args: Omit<PortalCreated, '_tag'>): PortalCreated => ({
  _tag: 'portal.created',
  ...args,
})
```

Rule: standards.md §1 — "Constructors validate required fields"
Fix: Add `assert(args.occurredAt instanceof Date, 'occurredAt must be Date')` to all portal constructors, consistent with review/inbox/staff/property/team/metric/integration/identity patterns.

#### M6 — Goal constructors lack validation (no assert on occurredAt)

**EventConsistency** MAJOR Goal constructors pass through args without any validation
File: src/contexts/goal/domain/events.ts:48-58
Quote:

```
export const goalCompleted = (args: Omit<GoalCompleted, '_tag'>): GoalCompleted => ({
  _tag: 'goal.completed',
  ...args,
})
```

Rule: standards.md §1 — "Constructors validate required fields"
Fix: Add `assert(args.occurredAt instanceof Date, ...)` and `assert(args.completedAt instanceof Date, ...)` for GoalCompleted; `assert(args.occurredAt instanceof Date, ...)` for GoalProgressUpdated.

#### M7 — GoalCompleted missing occurredAt field

**EventConsistency** MAJOR GoalCompleted has completedAt but no occurredAt
File: src/contexts/goal/domain/events.ts:15-32
Quote:

```
export type GoalCompleted = Readonly<{
  _tag: 'goal.completed'
  eventId: string
  correlationId: string | null
  ...
  completedAt: Date
  ...
}>
```

Rule: standards.md §1 — "All events carry occurredAt"
Fix: Add `occurredAt: Date` to GoalCompleted. The raw emit in the handler uses `completedAt` as the de-facto timestamp but the envelope field is missing. Consider renaming `completedAt` → `occurredAt` or adding both with `occurredAt` as the canonical envelope field.

#### M8 — GoalCompleted missing from shared re-exports but GoalProgressUpdated also missing eventId/correlationId in constructor

**EventConsistency** MAJOR GoalProgressUpdated constructor does not generate eventId or correlationId
File: src/contexts/goal/domain/events.ts:53-58
Quote:

```
export const goalProgressUpdated = (
  args: Omit<GoalProgressUpdated, '_tag'>,
): GoalProgressUpdated => ({
  _tag: 'goal.progress_updated',
  ...args,
})
```

Rule: standards.md §1 — constructors generate eventId and correlationId
Fix: The type lacks `eventId` and `correlationId` fields (see B3). Once added, the constructor must `Omit` them from args and generate `eventId: crypto.randomUUID(), correlationId: null`.

---

### MINOR

#### m1 — Dashboard context has no events (expected: read-only)

File: src/contexts/dashboard/domain/ (no events.ts)
Rule: N/A — informational
Fix: None needed. Dashboard is a read-only aggregation context.

#### m2 — Notification context has no events (expected: consumer only)

File: src/contexts/notification/domain/ (no events.ts)
Rule: N/A — informational
Fix: None needed. Notification consumes events from other contexts and enqueues jobs.

#### m3 — Activity context has no events (expected: consumer only)

File: src/contexts/activity/domain/ (no events.ts)
Rule: N/A — informational
Fix: None needed. Activity consumes events and writes audit log entries.

#### m4 — Portal link/group event types not exported from shared barrel

File: src/shared/events/events.ts:62-77
Quote:

```
export type {
  PortalEvent,
  PortalCreated,
  PortalUpdated,
  PortalDeleted,
  PortalGroupCreated,
  PortalGroupUpdated,
  PortalGroupDeleted,
} from '#/contexts/portal/domain/events'
```

Rule: Completeness — all subtypes should be individually re-exported
Fix: Add `PortalLinkCategoryCreated`, `PortalLinkCategoryReordered`, `PortalLinkCreated`, `PortalLinkReordered`, `PortalAddedToGroup`, `PortalRemovedFromGroup` to the shared re-exports. These are actively emitted but not individually accessible from the shared barrel.

#### m5 — Portal events use multi-entity \_tag format inconsistently

File: src/contexts/portal/domain/events.ts
Quote:

```
_tag: 'portal_link_category.created'
_tag: 'portal_link.created'
_tag: 'portal_group.created'
_tag: 'portal_group.portal_added'
```

Rule: standards.md §1 — "context.entity.verb format"
Fix: The multi-entity tags (portal_link._, portal_group._) are within the portal context but use a sub-entity prefix. This is arguably consistent with `context.entity.verb` where entity can be compound. Consider documenting this as an accepted pattern or normalizing to `portal.linkCreated`, `portal.groupCreated`, etc.

---

### NIT

#### n1 — Guest event handlers directory contains only a README

File: src/contexts/guest/infrastructure/event-handlers/README.md
Quote:

```
Guest context produces events but does not consume events from other contexts.
This directory is intentionally empty.
```

Rule: N/A
Fix: Consider removing the empty directory + README to avoid confusion, or keep as documentation.

#### n2 — Fallow ignore comments on all portal event types

File: src/contexts/portal/domain/events.ts:16-17,26-27,36-37,46-47,55-56,65-66,75-76,86-87,96-97,106-107,115-116,124-125
Quote:

```
// fallow-ignore-next-line unused-type
export type PortalCreated = Readonly<{ ... }>
```

Rule: N/A — tooling suppression
Fix: These suppressions exist because no code imports the individual types outside the union. Once the shared barrel exports them individually, these suppressions can be removed.

---

## Event Coverage Matrix

### Events Defined per Context

| Context     | # Types | All in Context Union | All in Shared Barrel | All have eventId | All have correlationId | All have occurredAt | Constructor validates |
| ----------- | ------- | -------------------- | -------------------- | ---------------- | ---------------------- | ------------------- | --------------------- |
| identity    | 6       | ✅                   | ✅ (all 6)           | ✅               | ✅                     | ✅                  | ✅                    |
| property    | 3       | ✅                   | ✅ (all 3)           | ✅               | ✅                     | ✅                  | ✅                    |
| team        | 3       | ✅                   | ✅ (all 3)           | ✅               | ✅                     | ✅                  | ✅                    |
| staff       | 2       | ✅                   | ✅ (all 2)           | ✅               | ✅                     | ✅                  | ✅                    |
| portal      | 12      | ✅                   | ⚠️ (7/12)            | ❌               | ❌                     | ✅                  | ❌                    |
| guest       | 4       | ✅                   | ✅ (all 4)           | ✅               | ✅                     | ✅                  | ✅                    |
| integration | 4       | ✅                   | ✅ (all 4)           | ✅               | ✅                     | ✅                  | ✅                    |
| review      | 8       | ✅                   | ⚠️ (5/8)             | ✅               | ✅                     | ✅                  | ✅                    |
| inbox       | 7       | ✅                   | ⚠️ (3/7)             | ✅               | ✅                     | ✅                  | ✅                    |
| goal        | 2       | ✅                   | ✅ (all 2)           | ⚠️ (1/2)         | ⚠️ (1/2)               | ⚠️ (1/2)            | ❌                    |
| metric      | 1       | ✅                   | ✅ (all 1)           | ✅               | ✅                     | ✅                  | ✅                    |

### Events Emitted vs Orphan

| Event                                            | Emitted                                             | Consumed (handlers)           |
| ------------------------------------------------ | --------------------------------------------------- | ----------------------------- |
| identity.organization.created                    | ✅ register-user-and-org                            | —                             |
| identity.member.invited                          | ✅ invite-member                                    | —                             |
| identity.invitation.accepted                     | ❌ ORPHAN                                           | —                             |
| identity.invitation.rejected                     | ❌ ORPHAN                                           | —                             |
| identity.member.removed                          | ✅ remove-member                                    | —                             |
| identity.member.role_changed                     | ✅ update-member-role                               | —                             |
| property.created                                 | ✅ create-property + adapter                        | review, goal                  |
| property.updated                                 | ✅ update-property                                  | —                             |
| property.deleted                                 | ✅ soft-delete-property                             | —                             |
| team.created                                     | ✅ create-team                                      | —                             |
| team.updated                                     | ✅ update-team                                      | —                             |
| team.deleted                                     | ✅ soft-delete-team                                 | —                             |
| staff.assigned                                   | ✅ create-staff-assignment + update-staff-portals   | —                             |
| staff.unassigned                                 | ✅ remove-staff-assignment + update-staff-portals   | —                             |
| portal.created                                   | ✅ create-portal                                    | goal                          |
| portal.updated                                   | ✅ update-portal                                    | —                             |
| portal.deleted                                   | ✅ soft-delete-portal                               | goal                          |
| portal_link_category.created                     | ✅ create-link-category                             | —                             |
| portal_link_category.reordered                   | ✅ reorder-categories                               | —                             |
| portal_link.created                              | ✅ create-link                                      | —                             |
| portal_link.reordered                            | ✅ reorder-links                                    | —                             |
| portal_group.created                             | ✅ create-portal-group                              | —                             |
| portal_group.updated                             | ✅ update-portal-group                              | —                             |
| portal_group.deleted                             | ✅ soft-delete-portal-group + delete-portal-group   | goal                          |
| portal_group.portal_added                        | ✅ create-portal-group + add-portal-to-group        | —                             |
| portal_group.portal_removed                      | ✅ remove-portal-from-group                         | —                             |
| guest.scan.recorded                              | ✅ record-scan                                      | metric                        |
| guest.rating.submitted                           | ✅ submit-rating                                    | metric                        |
| guest.feedback.submitted                         | ✅ submit-feedback                                  | metric, inbox                 |
| guest.review_link.clicked                        | ✅ track-review-link-click                          | metric                        |
| integration.google_account.connected             | ✅ connect-google-account                           | —                             |
| integration.google_account.disconnected          | ✅ disconnect-google-account                        | —                             |
| integration.google_connection.visibility_changed | ✅ update-connection-visibility                     | —                             |
| integration.property_import.completed            | ❌ ORPHAN                                           | —                             |
| review.created                                   | ✅ sync-reviews                                     | inbox, metric, notification   |
| review.updated                                   | ✅ sync-reviews                                     | inbox                         |
| review.expired                                   | ✅ purge-expired-reviews                            | —                             |
| review.reply.submitted                           | ✅ reply-operations                                 | activity, inbox, notification |
| review.reply.approved                            | ✅ reply-operations                                 | activity, notification        |
| review.reply.rejected                            | ✅ reply-operations                                 | activity, notification        |
| review.reply.published                           | ✅ reply-operations                                 | activity, inbox, notification |
| review.reply.publish_failed                      | ✅ reply-operations                                 | notification                  |
| inbox.inbox_item.created                         | ✅ create-inbox-item                                | activity, notification        |
| inbox.inbox_item.status_changed                  | ✅ update-inbox-status + on-reply-published (inbox) | activity                      |
| inbox.inbox_item.escalated                       | ✅ update-inbox-status                              | activity, notification        |
| inbox.inbox_item.assigned                        | ✅ assign-inbox-item                                | activity, notification        |
| inbox.inbox_item.unassigned                      | ✅ assign-inbox-item                                | activity                      |
| inbox.inbox_note.added                           | ✅ add-inbox-note                                   | activity, notification        |
| inbox.inbox_item.bulk_status_changed             | ✅ bulk-update-inbox-status                         | activity                      |
| goal.completed                                   | ✅ on-metric-recorded                               | notification                  |
| goal.progress_updated                            | ✅ on-metric-recorded                               | —                             |
| metric.recorded                                  | ✅ record-metric                                    | goal                          |

### Phantom Handler Check

All subscribed event tags resolve to defined event types. No phantom handlers found.

| Consumer Context | Subscribed Tags                                                                                                                                                                                                                                                                                           | All Resolve |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| review           | property.created                                                                                                                                                                                                                                                                                          | ✅          |
| inbox            | review.created, guest.feedback.submitted, review.updated, review.reply.published, review.reply.submitted                                                                                                                                                                                                  | ✅          |
| notification     | review.created, inbox.inbox_item.created, inbox.inbox_item.assigned, inbox.inbox_item.escalated, inbox.inbox_note.added, review.reply.submitted, review.reply.approved, review.reply.rejected, review.reply.published, review.reply.publish_failed, goal.completed                                        | ✅          |
| metric           | guest.scan.recorded, guest.rating.submitted, guest.feedback.submitted, guest.review_link.clicked, review.created                                                                                                                                                                                          | ✅          |
| goal             | metric.recorded, portal.deleted, portal_group.deleted                                                                                                                                                                                                                                                     | ✅          |
| activity         | inbox.inbox_item.created, inbox.inbox_item.status_changed, inbox.inbox_item.escalated, inbox.inbox_item.assigned, inbox.inbox_item.unassigned, inbox.inbox_note.added, inbox.inbox_item.bulk_status_changed, review.reply.published, review.reply.submitted, review.reply.approved, review.reply.rejected | ✅          |
