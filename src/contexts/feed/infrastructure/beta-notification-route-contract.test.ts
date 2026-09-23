// Every beta notification route, from its real producer.
//
// Consumer tests hand-build their envelopes, and that is how whole routes
// shipped dead while every suite stayed green: the delayed execution gate
// keyed Property scope by action, so each Organization-scoped route was denied
// before its handler ran, and the Portal Health consumer rejected the envelope
// aggregate its producer really writes. Here each
// BETA_NOTIFICATION_TRIGGER_MATRIX row starts from the upstream context's real
// event constructor and travels the production path — toOutboxEvent, a jsonb
// round trip, buildConsumerEvent — into the REAL delayed execution policy, the
// worker's dispatcher, the registered consumer and the durable delivery
// bridge. Nothing on that path is mocked; only the consumers' reads are fakes.

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
  inboxAssignmentsReleased,
  inboxBulkAssignmentCompleted,
  inboxBulkReopenCompleted,
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
  reviewReplyPublicationCancelled,
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
import {
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
} from '#/contexts/integration/domain/events'
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
import { registerAssignmentReleaseNotificationConsumer } from './assignment-release-outbox-consumers'
import { registerEscalationResolutionNotificationConsumer } from './escalation-resolution-outbox-consumers'
import { registerGoalNotificationConsumer } from './goal-outbox-consumers'
import { registerHandlingCycleNotificationConsumers } from './handling-cycle-outbox-consumers'
import { registerResponseTargetNotificationConsumer } from './response-target-outbox-consumers'
import { registerPortalHealthNotificationConsumer } from './portal-health-outbox-consumers'
import {
  registerIdentityAccountNotificationConsumers,
  registerOrganizationPurgePendingNoticeConsumer,
} from './identity-account-outbox-consumers'
import {
  INSERT_NOTIFICATION_JOB_NAME,
  type InsertNotificationJobData,
} from './jobs/insert-notification.job'
import type { GoogleConnectionPropertyLookup } from './integration-outbox-consumers'
import {
  parseOutboxNotificationDelivery,
  withBetaOutboxNotificationDelivery,
} from './outbox-notification-delivery'
import {
  createNotificationAudienceAuthorizer,
  parseNotificationAudience,
} from '../application/notification-audience'
import type { EscalationResolutionLookupPort } from '../application/ports/escalation-resolution-lookup.port'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import type { OutboxRepository } from '#/shared/outbox'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import type { Job } from 'bullmq'
import { MANDATORY_EMAIL_JOB_NAME, URGENT_EMAIL_JOB_NAME } from './jobs/urgent-email.job'

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
const DEPARTING = userId('user-departing')
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
  'inbox.inbox_items.bulk_reopen_completed': () =>
    inboxBulkReopenCompleted({
      organizationId: ORG,
      userId: ACTOR,
      bulkId: BULK,
      reopened: [
        {
          inboxItemId: ITEM,
          propertyId: PROPERTY,
          sourceType: handlingCycleScope.sourceType,
          sourceId: REVIEW,
          cycleNumber: handlingCycleScope.cycleNumber,
          sourceRevision: handlingCycleScope.sourceRevision,
          stateRevision: handlingCycleScope.stateRevision,
        },
      ],
      occurredAt: OCCURRED_AT,
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
  'inbox.inbox_items.assignments_released': () =>
    inboxAssignmentsReleased({
      organizationId: ORG,
      userId: ACTOR,
      releasedFrom: DEPARTING,
      releaseReason: 'member_offboarded',
      releases: [{ inboxItemId: ITEM, propertyId: PROPERTY }],
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
    reviewReplyPublishFailed({ ...replyFact, authorId: RECIPIENT, outcome: 'not_sent' }),
  'review.reply.publication_cancelled': () =>
    reviewReplyPublicationCancelled({
      ...replyFact,
      authorId: RECIPIENT,
      cause: 'disconnect',
    }),
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
      reason: 'publication_snapshot_unavailable',
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
  'integration.google_account.disconnected': () =>
    integrationGoogleAccountDisconnected({
      connectionId: CONNECTION,
      organizationId: ORG,
      userId: ACTOR,
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

type RouteDeps = ReturnType<typeof createNotificationConsumerDeps> &
  Readonly<{
    receipts: Pick<OutboxRepository, 'insertReceipt'>
    escalationResolutions: EscalationResolutionLookupPort
    monthlyResultFacts: MonthlyResultNotificationFactsLookup
    googleConnectionProperties: GoogleConnectionPropertyLookup
  }>

/** Reads that find nothing, for tests that never run a handler. */
function inertRouteDeps(): RouteDeps {
  return {
    ...createNotificationConsumerDeps(),
    receipts: { insertReceipt: vi.fn(async () => {}) },
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
}

/** Every notification consumer the worker registers, over the given reads. */
function registerNotificationRoutes(
  deps: RouteDeps = inertRouteDeps(),
): ConsumerRegistry {
  const registry = createConsumerRegistry()
  registerIdentityAccountNotificationConsumers(registry, deps)
  registerOrganizationPurgePendingNoticeConsumer(registry, deps)
  registerNotificationConsumers(registry, deps)
  registerWorkflowNotificationConsumers(registry, deps)
  registerBulkAssignmentNotificationConsumer(registry, deps)
  registerAssignmentReleaseNotificationConsumer(registry, deps)
  registerEscalationResolutionNotificationConsumer(registry, deps)
  registerHandlingCycleNotificationConsumers(registry, deps)
  registerResponseTargetNotificationConsumer(registry, deps)
  registerGoalNotificationConsumer(registry, deps)
  registerPortalNotificationConsumers(registry, deps)
  registerPortalHealthNotificationConsumer(registry, deps)
  registerPropertyNotificationConsumers(registry, deps)
  registerIntegrationNotificationConsumers(registry, deps)
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

/** The same job for an Organization-scoped mandatory notice, which has its own gate. */
function mandatoryEmailJob() {
  return {
    notificationEmailId: '4d1f0c1e-2b7a-4c55-9a51-000000000012',
    ...createJobExecutionEnvelope({
      organizationId: ORG,
      capability: 'notification.send_mandatory_email',
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
      MANDATORY_EMAIL_JOB_NAME,
      mandatoryEmailJob(),
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

  it('sends a mandatory notice from an Organization the email allowlist does not admit', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))

    const mandatoryNotice = await gateJob(
      MANDATORY_EMAIL_JOB_NAME,
      mandatoryEmailJob(),
      'worker:default',
      'worker',
    )
    const optionalNotice = await gateJob(
      URGENT_EMAIL_JOB_NAME,
      urgentEmailJob({ propertyId: PROPERTY }),
      'worker:default',
      'worker',
    )

    // A final deletion warning nobody receives is worse than an extra email;
    // ordinary product mail still waits for the allowlist.
    expect(mandatoryNotice.decision.reason).toBe('allowed')
    expect(optionalNotice.decision.reason).toBe('org_not_allowlisted')
  })

  it('still stops mandatory mail for the environment stop and for a suspended tenant', async () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: ORG,
        BETA_SUSPENDED_ORGS: ORG,
      }),
    )
    const suspended = await gateJob(
      MANDATORY_EMAIL_JOB_NAME,
      mandatoryEmailJob(),
      'worker:default',
      'worker',
    )

    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'all' }),
    )
    const stopped = await gateJob(
      MANDATORY_EMAIL_JOB_NAME,
      mandatoryEmailJob(),
      'worker:default',
      'worker',
    )

    expect(suspended.decision.reason).toBe('org_suspended')
    expect(stopped.decision.reason).toBe('capability_disabled')
  })
})

const MANAGER = userId('user-manager')
const ADMIN = userId('user-admin')

/** Reads that find each route's subject still current, so every route has work. */
function currentRouteDeps(): RouteDeps {
  const deps = inertRouteDeps()
  const item = {
    propertyId: PROPERTY,
    portalId: null,
    assignedTo: null,
    propertyName: 'Riverside Hotel',
    guestRating: null,
    sourceType: 'review',
    createdAt: OCCURRED_AT,
  }
  const cycle = {
    ...item,
    sourceId: REVIEW,
    currentCycleNumber: handlingCycleScope.cycleNumber,
    currentSourceRevision: handlingCycleScope.sourceRevision,
    stateRevision: handlingCycleScope.stateRevision,
    status: 'open',
  } as const
  const goal = {
    programId: GOAL.programId,
    assignmentId: GOAL.assignmentId,
    monthlyResultId: GOAL.monthlyResultId,
    programName: 'Monthly rating goal',
    subject: { kind: 'property', propertyId: PROPERTY },
  } as const
  deps.userLookup.findByRole.mockResolvedValue([ADMIN])
  deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER])
  deps.responsibleManagers.findForPortal.mockResolvedValue([MANAGER])
  deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
  deps.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(ITEM)
  deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue(item)
  deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue(cycle)
  deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
    ...cycle,
    sourceType: 'review',
    targetKind: 'google_review_response',
    reminderKind: 'target_passed',
    scheduledFor: SCHEDULED_FOR,
  })
  return {
    ...deps,
    escalationResolutions: {
      findEscalationResolutionFacts: vi.fn(async () => ({
        propertyId: PROPERTY,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        isEscalated: false,
        resolvedAt: OCCURRED_AT,
        resolvedBy: ACTOR,
      })),
    },
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts: vi.fn(async () => goal),
      findMonthlyResultRevisionNotificationFacts: vi.fn(async () => ({
        ...goal,
        programVersionId: GOAL.programVersionId,
        revisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000010',
        revision: 2,
        evaluationState: 'eligible' as const,
        achieved: true,
      })),
    },
    googleConnectionProperties: {
      findGoogleNotificationAnchor: vi.fn(async () => PROPERTY),
    },
  }
}

type Receipt = Readonly<{ eventId: string; consumerName: string; status: string }>

const recordInto =
  (receipts: Receipt[]) =>
  async (eventId: string, consumerName: string, status: string) => {
    receipts.push({ eventId, consumerName, status })
  }

/**
 * Run one produced fact through the worker's dispatcher, its consumers
 * enqueueing through the durable delivery bridge onto a recording queue.
 * `receipts` are the ones the consumers and the bridge wrote; `gateDenials`
 * the ones the dispatcher wrote itself, which it does only when the gate
 * denies a consumer terminally — under the consumer's own name, as
 * `obsolete`, without running it.
 */
async function dispatch(fact: DomainEvent, deps: RouteDeps = currentRouteDeps()) {
  const receipts: Receipt[] = []
  const gateDenials: Receipt[] = []
  const recordReceipt = recordInto(receipts)
  const queued: InsertNotificationJobData[] = []
  const recordingQueue = {
    add: async (_name: string, data: unknown) => {
      queued.push(data as InsertNotificationJobData)
    },
  }
  const registry = registerNotificationRoutes({
    ...deps,
    queue: withBetaOutboxNotificationDelivery(recordingQueue, {
      insertReceipt: recordReceipt,
    }) as RouteDeps['queue'],
    receipts: { insertReceipt: recordReceipt },
  })
  const envelope = deliveredEnvelope(fact)
  const repo = {
    hasReceipt: async () => false,
    insertReceipt: recordInto(gateDenials),
  } as unknown as OutboxRepository

  await createDispatcherHandler(repo, { consumers: registry })({
    id: envelope.eventId,
    name: envelope.eventType,
    data: envelope,
  } as unknown as Job)

  return { envelope, receipts, gateDenials, queued }
}

/**
 * A fact per conditional row that its condition turns away, and the receipt
 * the consumer records for it. A condition that only chooses between the
 * row's own types has none.
 */
const NO_NOTICE: Readonly<
  Record<
    string,
    Readonly<{
      fact: () => DomainEvent
      status: 'applied' | 'obsolete'
      arrange?: (deps: RouteDeps) => void
    }>
  >
> = {
  'identity.organization_lifecycle.changed': {
    fact: () =>
      identityOrganizationLifecycleChanged({
        organizationId: ORG,
        closureLineageId: CLOSURE_LINEAGE,
        state: 'closing',
        revision: 2,
        reactivationRequired: true,
        recoverableUntil: new Date('2026-10-02T09:00:00.000Z'),
        occurredAt: OCCURRED_AT,
      }),
    status: 'obsolete',
  },
  'inbox.inbox_item.created': {
    fact: PRODUCED_FACTS['inbox.inbox_item.created']!,
    status: 'applied',
    arrange: (deps) =>
      deps.inboxItemLookup.isHistoricalOnboardingItem.mockResolvedValue(true),
  },
  'inbox.handling_cycle.opened': {
    fact: () =>
      inboxHandlingCycleOpened({
        ...handlingCycleScope,
        actorType: 'provider',
        userId: null,
        openReason: 'review_observed',
      }),
    status: 'applied',
  },
  // A reopen stamped by a bulk reopen: its completion fact notifies instead.
  'inbox.handling_cycle.reopened': {
    fact: () =>
      inboxHandlingCycleReopened({
        ...handlingCycleScope,
        actorType: 'user',
        userId: ACTOR,
        reopenReason: 'new_information',
        bulkId: BULK,
        source: 'web',
      }),
    status: 'applied',
  },
  'portal.health.changed': {
    fact: () =>
      portalHealthChanged({
        portalId: PORTAL,
        organizationId: ORG,
        propertyId: PROPERTY,
        previousStatus: 'unavailable',
        previousReason: 'publication_snapshot_unavailable',
        status: 'healthy',
        reason: 'operational',
        sourceVersion: 'health-fence-2',
        occurredAt: OCCURRED_AT,
      }),
    status: 'obsolete',
  },
  'goal.monthly_result.closed': {
    fact: () =>
      goalMonthlyResultClosed({
        ...GOAL,
        organizationId: ORG,
        propertyId: PROPERTY,
        evaluationState: 'eligible',
        achieved: false,
        occurredAt: OCCURRED_AT,
      }),
    status: 'obsolete',
  },
  'goal.monthly_result.revised': {
    fact: () =>
      goalMonthlyResultRevised({
        ...GOAL,
        organizationId: ORG,
        propertyId: PROPERTY,
        evaluationState: 'eligible',
        achieved: true,
        revisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000010',
        revision: 2,
        supersedesRevisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000011',
        outcomeChanged: false,
        availabilityChanged: false,
        occurredAt: OCCURRED_AT,
      }),
    status: 'obsolete',
  },
}
const CONDITION_ONLY_CHOOSES_TYPE: ReadonlySet<string> = new Set([
  'inbox.response_target.reminder_due',
])

describe('every beta notification route queues its notice from its real producer', () => {
  it('has a turned-away fact for every row whose condition can turn one away', () => {
    expect(
      BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
        (route) =>
          'eventCondition' in route &&
          !CONDITION_ONLY_CHOOSES_TYPE.has(route.eventType) &&
          NO_NOTICE[route.eventType] === undefined,
      ).map((route) => route.eventType),
    ).toEqual([])
  })

  for (const route of BETA_NOTIFICATION_TRIGGER_MATRIX) {
    it(`${route.eventType}: ${route.consumerName} queues its notification durably`, async () => {
      const { envelope, receipts, gateDenials, queued } = await dispatch(
        PRODUCED_FACTS[route.eventType]!(),
      )
      const routeTypes: ReadonlyArray<string> = route.notifications.map(
        ({ type }) => type,
      )

      expect(gateDenials).toEqual([])
      expect(receipts).toContainEqual({
        eventId: envelope.eventId,
        consumerName: route.consumerName,
        status: 'applied',
      })
      expect(queued.length).toBeGreaterThan(0)
      for (const job of queued) {
        expect(routeTypes).toContain(job.type)
        expect(parseOutboxNotificationDelivery(job)).toMatchObject({
          eventId: envelope.eventId,
          eventType: route.eventType,
          consumerName: route.consumerName,
        })
        expect(parseNotificationAudience(job.audience), job.type).not.toBeNull()
        const gate = await gateJob(
          INSERT_NOTIFICATION_JOB_NAME,
          job,
          'worker:default',
          'worker',
        )
        expect(gate.decision.reason, job.type).toBe('allowed')
      }
    })
  }

  for (const [eventType, noNotice] of Object.entries(NO_NOTICE)) {
    it(`${eventType}: a fact its condition turns away queues nothing`, async () => {
      const deps = currentRouteDeps()
      noNotice.arrange?.(deps)
      const route = BETA_NOTIFICATION_TRIGGER_MATRIX.find(
        (candidate) => candidate.eventType === eventType,
      )!

      const { envelope, receipts, gateDenials, queued } = await dispatch(
        noNotice.fact(),
        deps,
      )

      // The consumer ran and turned the fact away; the gate did not refuse it.
      expect(gateDenials).toEqual([])
      expect(queued).toEqual([])
      expect(receipts).toContainEqual({
        eventId: envelope.eventId,
        consumerName: route.consumerName,
        status: noNotice.status,
      })
    })
  }
})

/**
 * The last warning before an irreversible deletion has no Property, and the
 * delivery-time check used to admit a Property-less notice only for an
 * affected Organization user — so this route reached nobody. The AccountAdmin
 * role is held at the Organization, so it is now re-read there.
 */
describe('the Purge Pending final notice reaches its AccountAdmins', () => {
  const authorizerFor = (deps: RouteDeps) =>
    createNotificationAudienceAuthorizer({
      ...deps,
      portalHealthLookup: {
        findPortalHealthNotificationFacts: vi.fn(async () => null),
      },
      organizationAccountAuthority: {
        isAffectedRecipient: vi.fn(async () => false),
      },
    })

  it('identity.organization_lifecycle.changed: every queued admin still passes the check', async () => {
    const deps = currentRouteDeps()
    const { queued } = await dispatch(
      PRODUCED_FACTS['identity.organization_lifecycle.changed']!(),
      deps,
    )
    const authorize = authorizerFor(deps)

    // Every queued recipient is a current AccountAdmin.
    expect(queued.map((job) => job.userId)).toEqual([ADMIN])
    for (const job of queued) {
      await expect(
        authorize({
          userId: job.userId,
          organizationId: job.organizationId,
          propertyId: job.propertyId,
          audience: parseNotificationAudience(job.audience)!,
        }),
      ).resolves.toBe(true)
    }
  })

  it('refuses the notice for someone who has lost the role since it was queued', async () => {
    const deps = currentRouteDeps()
    const { queued } = await dispatch(
      PRODUCED_FACTS['identity.organization_lifecycle.changed']!(),
      deps,
    )
    deps.userLookup.findByRole.mockResolvedValue([])

    for (const job of queued) {
      await expect(
        authorizerFor(deps)({
          userId: job.userId,
          organizationId: job.organizationId,
          propertyId: job.propertyId,
          audience: parseNotificationAudience(job.audience)!,
        }),
      ).resolves.toBe(false)
    }
  })
})
