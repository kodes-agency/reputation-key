// Every beta notification route, from its real producer.
//
// Consumer tests hand-build their envelopes, and that is how a whole class of
// routes shipped dead while every suite stayed green: the delayed execution
// gate keyed Property scope by action, so each Organization-scoped route was
// denied before its handler ran. Here each BETA_NOTIFICATION_TRIGGER_MATRIX
// row starts from the upstream context's real event constructor and travels
// the production path — toOutboxEvent, a jsonb round trip, buildConsumerEvent
// — before it meets the REAL delayed execution policy. Nothing on that path is
// mocked; only the consumers' own reads are fakes.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent, type ConsumerEvent } from '#/shared/outbox/envelope'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import {
  createJobExecutionEnvelope,
  gateDispatcherConsumer,
  gateJob,
} from '#/shared/jobs/delayed-execution-gate'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  googleConnectionId,
  inboxItemId,
  inboxNoteId,
  invitationId,
  organizationId,
  portalId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import {
  identityBetaFeedbackOutcomeReached,
  identityInvitationAccepted,
  identityMemberRemoved,
  identityMemberRoleChanged,
  identityOrganizationLifecycleChanged,
} from '#/contexts/identity/domain/events'
import {
  inboxBulkAssignmentCompleted,
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  inboxItemAssigned,
  inboxItemCreated,
  inboxItemEscalated,
  inboxItemEscalationResolved,
  inboxNoteAdded,
  inboxResponseTargetReminderDue,
} from '#/contexts/inbox/domain/events'
import {
  reviewReplyApproved,
  reviewReplyPublished,
  reviewReplyPublishFailed,
  reviewReplyRejected,
  reviewReplySubmitted,
} from '#/contexts/review/domain/events'
import {
  portalHealthChanged,
  portalResponsibilityNeeded,
} from '#/contexts/portal/domain/events'
import { propertyResponsibilityNeeded } from '#/contexts/property/domain/events'
import { integrationGoogleAccountReauthorizationRequired } from '#/contexts/integration/domain/events'
import {
  goalMonthlyResultClosed,
  goalMonthlyResultRevised,
} from '#/contexts/reporting/domain/goal-events'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../application/beta-notification-trigger-matrix'
import { notificationScopeForType } from '../domain/notification-delivery-policy'
import type { NotificationType } from '../domain/notification-types'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import { registerNotificationConsumers } from './notification-outbox-consumers'
import { registerWorkflowNotificationConsumers } from './workflow-outbox-consumers'
import { registerPortalNotificationConsumers } from './portal-outbox-consumers'
import { registerPropertyNotificationConsumers } from './property-outbox-consumers'
import { registerIntegrationNotificationConsumers } from './integration-outbox-consumers'
import { registerBulkAssignmentNotificationConsumer } from './bulk-assignment-outbox-consumers'
import { registerEscalationResolutionNotificationConsumer } from './escalation-resolution-outbox-consumers'
import { registerGoalNotificationConsumer } from './goal-outbox-consumers'
import { registerHandlingCycleNotificationConsumers } from './handling-cycle-outbox-consumers'
import { registerResponseTargetNotificationConsumer } from './response-target-outbox-consumers'
import { registerPortalHealthNotificationConsumer } from './portal-health-outbox-consumers'
import {
  registerIdentityAccountNotificationConsumers,
  registerOrganizationPurgePendingNoticeConsumer,
} from './identity-account-outbox-consumers'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { URGENT_EMAIL_JOB_NAME } from './jobs/urgent-email.job'

const ORG = organizationId('org-route-contract')
const PROPERTY = propertyId('4d1f0c1e-2b7a-4c55-9a51-000000000001')
const PORTAL = portalId('4d1f0c1e-2b7a-4c55-9a51-000000000002')
const ITEM = inboxItemId('4d1f0c1e-2b7a-4c55-9a51-000000000003')
const REVIEW = reviewId('4d1f0c1e-2b7a-4c55-9a51-000000000004')
const REPLY = replyId('4d1f0c1e-2b7a-4c55-9a51-000000000005')
const NOTE = inboxNoteId('4d1f0c1e-2b7a-4c55-9a51-000000000006')
const CONNECTION = googleConnectionId('4d1f0c1e-2b7a-4c55-9a51-000000000007')
const INVITATION = invitationId('4d1f0c1e-2b7a-4c55-9a51-000000000008')
const REPORT_REFERENCE = '4d1f0c1e-2b7a-4c55-9a51-000000000009'
const CLOSURE_LINEAGE = '4d1f0c1e-2b7a-4c55-9a51-00000000000a'
const BULK = '4d1f0c1e-2b7a-4c55-9a51-00000000000b'
const GOAL = {
  programId: '4d1f0c1e-2b7a-4c55-9a51-00000000000c',
  programVersionId: '4d1f0c1e-2b7a-4c55-9a51-00000000000d',
  assignmentId: '4d1f0c1e-2b7a-4c55-9a51-00000000000e',
  monthlyResultId: '4d1f0c1e-2b7a-4c55-9a51-00000000000f',
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
} as const
const ACTOR = userId('user-actor')
const RECIPIENT = userId('user-recipient')
const OCCURRED_AT = new Date('2026-09-02T09:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-09-02T08:00:00.000Z')

const handlingCycleScope = {
  inboxItemId: ITEM,
  cycleNumber: 2,
  stateRevision: 3,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'review',
  sourceId: REVIEW,
  sourceRevision: 2,
  triggerEventId: null,
  occurredAt: OCCURRED_AT,
} as const

const replyFact = {
  replyId: REPLY,
  reviewId: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  occurredAt: OCCURRED_AT,
} as const

/**
 * One fact per matrix row, built by its producing context's own constructor.
 * Each satisfies the row's event condition, so the route has work to do.
 */
const PRODUCED_FACTS: Readonly<Record<string, () => DomainEvent>> = {
  'identity.invitation.accepted': () =>
    identityInvitationAccepted({
      invitationId: INVITATION,
      organizationId: ORG,
      userId: RECIPIENT,
      propertyIds: [PROPERTY],
      occurredAt: OCCURRED_AT,
    }),
  'identity.member.role_changed': () =>
    identityMemberRoleChanged({
      organizationId: ORG,
      memberUserId: RECIPIENT,
      previousRole: 'PropertyManager',
      newRole: 'AccountAdmin',
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'identity.member.removed': () =>
    identityMemberRemoved({
      organizationId: ORG,
      userId: RECIPIENT,
      removedBy: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'identity.beta_feedback.outcome_reached': () =>
    identityBetaFeedbackOutcomeReached({
      organizationId: ORG,
      userId: RECIPIENT,
      reference: REPORT_REFERENCE,
      outcome: 'accepted',
      occurredAt: OCCURRED_AT,
    }),
  'identity.organization_lifecycle.changed': () =>
    identityOrganizationLifecycleChanged({
      organizationId: ORG,
      closureLineageId: CLOSURE_LINEAGE,
      state: 'purge_pending',
      revision: 3,
      reactivationRequired: true,
      recoverableUntil: new Date('2026-10-02T09:00:00.000Z'),
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.created': () =>
    inboxItemCreated({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceType: 'review',
      sourceId: REVIEW,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.handling_cycle.opened': () =>
    inboxHandlingCycleOpened({
      ...handlingCycleScope,
      actorType: 'provider',
      userId: null,
      openReason: 'material_revision_changed',
    }),
  'inbox.handling_cycle.reopened': () =>
    inboxHandlingCycleReopened({
      ...handlingCycleScope,
      actorType: 'user',
      userId: ACTOR,
      reopenReason: 'new_information',
      source: 'web',
    }),
  'inbox.response_target.reminder_due': () =>
    inboxResponseTargetReminderDue({
      inboxItemId: ITEM,
      cycleNumber: 2,
      organizationId: ORG,
      propertyId: PROPERTY,
      targetKind: 'google_review_response',
      reminderKind: 'target_passed',
      scheduledFor: SCHEDULED_FOR,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.assigned': () =>
    inboxItemAssigned({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      assignedTo: RECIPIENT,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_items.bulk_assignment_completed': () =>
    inboxBulkAssignmentCompleted({
      organizationId: ORG,
      userId: ACTOR,
      bulkId: BULK,
      transitions: [
        {
          inboxItemId: ITEM,
          propertyId: PROPERTY,
          previousAssignee: null,
          nextAssignee: RECIPIENT,
        },
      ],
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.escalated': () =>
    inboxItemEscalated({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.escalation_resolved': () =>
    inboxItemEscalationResolved({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_note.added': () =>
    inboxNoteAdded({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      noteId: NOTE,
      occurredAt: OCCURRED_AT,
    }),
  'review.reply.submitted': () => reviewReplySubmitted({ ...replyFact, userId: ACTOR }),
  'review.reply.approved': () =>
    reviewReplyApproved({ ...replyFact, userId: ACTOR, authorId: RECIPIENT }),
  'review.reply.rejected': () =>
    reviewReplyRejected({
      ...replyFact,
      userId: ACTOR,
      authorId: RECIPIENT,
      reason: null,
    }),
  'review.reply.published': () =>
    reviewReplyPublished({ ...replyFact, userId: ACTOR, authorId: RECIPIENT }),
  'review.reply.publish_failed': () =>
    reviewReplyPublishFailed({ ...replyFact, authorId: RECIPIENT }),
  'portal.responsibility_became_needed': () =>
    portalResponsibilityNeeded({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceAggregateVersion: OCCURRED_AT.toISOString(),
      occurredAt: OCCURRED_AT,
    }),
  'portal.health.changed': () =>
    portalHealthChanged({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      previousStatus: 'healthy',
      previousReason: 'operational',
      status: 'unavailable',
      reason: 'property_unavailable',
      sourceVersion: 'health-fence-1',
      occurredAt: OCCURRED_AT,
    }),
  'property.responsibility_became_needed': () =>
    propertyResponsibilityNeeded({
      organizationId: ORG,
      propertyId: PROPERTY,
      occurredAt: OCCURRED_AT,
    }),
  'integration.google_account.reauthorization_required': () =>
    integrationGoogleAccountReauthorizationRequired({
      connectionId: CONNECTION,
      organizationId: ORG,
      cause: 'member_removed',
      occurredAt: OCCURRED_AT,
    }),
  'goal.monthly_result.closed': () =>
    goalMonthlyResultClosed({
      ...GOAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      evaluationState: 'eligible',
      achieved: true,
      occurredAt: OCCURRED_AT,
    }),
  'goal.monthly_result.revised': () =>
    goalMonthlyResultRevised({
      ...GOAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      evaluationState: 'eligible',
      achieved: true,
      revisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000010',
      revision: 2,
      supersedesRevisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000011',
      outcomeChanged: true,
      availabilityChanged: false,
      occurredAt: OCCURRED_AT,
    }),
}

/** The producer's commit, the outbox row's jsonb round trip, and the relay. */
function deliveredEnvelope(fact: DomainEvent): ConsumerEvent {
  const row = toOutboxEvent(fact)
  return buildConsumerEvent({
    id: fact.eventId,
    eventType: row.eventType,
    eventVersion: row.eventVersion ?? 1,
    payload: JSON.parse(JSON.stringify(row.payload)),
    organizationId: row.organizationId,
    propertyId: row.propertyId ?? null,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    recordedAt: OCCURRED_AT,
  })
}

/** Every notification consumer the worker registers, over inert fakes. */
function registerNotificationRoutes(): ConsumerRegistry {
  const registry = createConsumerRegistry()
  const fakes = createNotificationConsumerDeps()
  const receipts = { insertReceipt: vi.fn(async () => {}) }
  const lookups = {
    escalationResolutions: {
      findEscalationResolutionFacts: vi.fn(async () => null),
    },
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts: vi.fn(async () => null),
      findMonthlyResultRevisionNotificationFacts: vi.fn(async () => null),
    },
    googleConnectionProperties: {
      findGoogleNotificationAnchor: vi.fn(async () => null),
    },
  }
  registerIdentityAccountNotificationConsumers(registry, { ...fakes, receipts })
  registerOrganizationPurgePendingNoticeConsumer(registry, { ...fakes, receipts })
  registerNotificationConsumers(registry, { ...fakes, receipts })
  registerWorkflowNotificationConsumers(registry, { ...fakes, receipts })
  registerBulkAssignmentNotificationConsumer(registry, { ...fakes, receipts })
  registerEscalationResolutionNotificationConsumer(registry, {
    ...fakes,
    ...lookups,
    receipts,
  })
  registerHandlingCycleNotificationConsumers(registry, { ...fakes, receipts })
  registerResponseTargetNotificationConsumer(registry, { ...fakes, receipts })
  registerGoalNotificationConsumer(registry, { ...fakes, ...lookups, receipts })
  registerPortalNotificationConsumers(registry, { ...fakes, receipts })
  registerPortalHealthNotificationConsumer(registry, { ...fakes, receipts })
  registerPropertyNotificationConsumers(registry, { ...fakes, receipts })
  registerIntegrationNotificationConsumers(registry, { ...fakes, ...lookups, receipts })
  return registry
}

/** The job a route queues for one notification type, scoped as the type demands. */
function insertNotificationJob(type: NotificationType, envelope: ConsumerEvent) {
  return {
    userId: RECIPIENT,
    organizationId: envelope.organizationId,
    propertyId: notificationScopeForType(type) === 'organization' ? null : PROPERTY,
    type,
    resourceType: 'inbox_item',
    resourceId: ITEM,
    eventId: envelope.eventId,
  }
}

/** The immediate-email job the insert path queues, with its execution envelope. */
function urgentEmailJob(scope: Readonly<{ propertyId?: string }>) {
  return {
    notificationEmailId: '4d1f0c1e-2b7a-4c55-9a51-000000000012',
    ...createJobExecutionEnvelope({
      organizationId: ORG,
      ...scope,
      capability: 'notification.send_email',
      initiator: { kind: 'system', id: 'notification:urgent-enqueue' },
      correlationId: 'notification-email:4d1f0c1e-2b7a-4c55-9a51-000000000012',
    }),
  }
}

beforeAll(() => {
  registerAllEventSchemas()
})

beforeEach(() => {
  // Every capability a route needs is granted, so the only thing left for the
  // gate to judge is the scope each envelope and job carries.
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: ORG }))
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
})

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('every beta notification route passes the delayed execution gate', () => {
  it('has a produced fact for every matrix row', () => {
    expect(
      BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
        (route) => PRODUCED_FACTS[route.eventType] === undefined,
      ).map((route) => route.eventType),
    ).toEqual([])
  })

  for (const route of BETA_NOTIFICATION_TRIGGER_MATRIX) {
    it(`${route.eventType}: ${route.consumerName} is allowed`, async () => {
      const envelope = deliveredEnvelope(PRODUCED_FACTS[route.eventType]!())
      const registration = registerNotificationRoutes()
        .listFor(route.eventType)
        .find((candidate) => candidate.consumerName === route.consumerName)

      const outcome = await gateDispatcherConsumer(
        route.consumerName,
        registration!.module,
        envelope,
      )

      expect(outcome.decision.reason).toBe('allowed')
    })

    it(`${route.eventType}: the insert-notification jobs it queues are allowed`, async () => {
      const envelope = deliveredEnvelope(PRODUCED_FACTS[route.eventType]!())

      for (const { type } of route.notifications) {
        const outcome = await gateJob(
          INSERT_NOTIFICATION_JOB_NAME,
          insertNotificationJob(type as NotificationType, envelope),
          'worker:default',
          'worker',
        )
        expect(outcome.decision.reason, type).toBe('allowed')
      }
    })
  }

  it('allows the immediate email of an Organization notice and of a Property one', async () => {
    const organizationNotice = await gateJob(
      URGENT_EMAIL_JOB_NAME,
      urgentEmailJob({}),
      'worker:default',
      'worker',
    )
    const propertyNotice = await gateJob(
      URGENT_EMAIL_JOB_NAME,
      urgentEmailJob({ propertyId: PROPERTY }),
      'worker:default',
      'worker',
    )

    expect(organizationNotice.decision.reason).toBe('allowed')
    expect(propertyNotice.decision.reason).toBe('allowed')
  })
})
