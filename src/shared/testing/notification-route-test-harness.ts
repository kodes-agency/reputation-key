import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import {
  type NotificationId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import type { OutboxRepository } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { buildConsumerEvent, type ConsumerEvent } from '#/shared/outbox/envelope'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import type { Job } from 'bullmq'
import { expect, vi } from 'vitest'
import type { BetaNotificationTriggerMatrixRow } from '#/contexts/feed/application/beta-notification-trigger-matrix'
import type { EscalationResolutionLookupPort } from '#/contexts/feed/application/ports/escalation-resolution-lookup.port'
import type { NotificationRepositoryPort } from '#/contexts/feed/application/ports/notification-repository.port'
import { registerAiGuestVoiceSummaryNoticeConsumer } from '#/contexts/feed/infrastructure/goal-notice-routes'
import { registerAiUrgentReviewNoticeConsumer } from '#/contexts/feed/infrastructure/goal-notice-routes'
import { registerAssignmentReleaseNotificationConsumer } from '#/contexts/feed/infrastructure/assignment-release-outbox-consumers'
import { registerBulkAssignmentNotificationConsumer } from '#/contexts/feed/infrastructure/bulk-assignment-outbox-consumers'
import { registerEscalationResolutionNotificationConsumer } from '#/contexts/feed/infrastructure/escalation-resolution-outbox-consumers'
import { registerGoalNotificationConsumer } from '#/contexts/feed/infrastructure/goal-notice-routes'
import { registerHandlingCycleNotificationConsumers } from '#/contexts/feed/infrastructure/handling-cycle-outbox-consumers'
import { registerIdentityAccountNotificationConsumers } from '#/contexts/feed/infrastructure/identity-account-outbox-consumers'
import type { GoogleConnectionPropertyLookup } from '#/contexts/feed/infrastructure/integration-outbox-consumers'
import { registerIntegrationNotificationConsumers } from '#/contexts/feed/infrastructure/integration-outbox-consumers'
import { type InsertNotificationJobData } from '#/contexts/feed/infrastructure/jobs/insert-notification.job'
import {
  noGroupedReopens,
  waitingWorkState,
} from '#/contexts/feed/infrastructure/jobs/test-fixtures'
import { createNotificationConsumerDeps } from '#/contexts/feed/infrastructure/notification-consumer-test-fixtures'
import { registerNotificationConsumers } from '#/contexts/feed/infrastructure/notification-outbox-consumers'
import { registerNotificationSettlementConsumers } from '#/contexts/feed/infrastructure/notification-settlement-outbox-consumers'
import {
  parseOutboxNotificationDelivery,
  withBetaOutboxNotificationDelivery,
} from '#/contexts/feed/infrastructure/outbox-notification-delivery'
import { registerPortalDestinationNotificationConsumer } from '#/contexts/feed/infrastructure/portal-destination-outbox-consumers'
import { registerPortalHealthNotificationConsumer } from '#/contexts/feed/infrastructure/portal-health-outbox-consumers'
import { registerPortalNotificationConsumers } from '#/contexts/feed/infrastructure/portal-outbox-consumers'
import { registerPropertyNotificationConsumers } from '#/contexts/feed/infrastructure/property-outbox-consumers'
import { registerRatingGoalNoticeConsumer } from '#/contexts/feed/infrastructure/goal-notice-routes'
import { registerResponseTargetNotificationConsumer } from '#/contexts/feed/infrastructure/response-target-outbox-consumers'
import {
  registerReviewImportNotificationConsumers,
  type PropertyImportInitiatorLookup,
} from '#/contexts/feed/infrastructure/review-import-outbox-consumers'
import { registerWorkflowNotificationConsumers } from '#/contexts/feed/infrastructure/workflow-outbox-consumers'

import {
  ACTOR,
  ADMIN,
  GOAL,
  handlingCycleScope,
  ITEM,
  MANAGER,
  OCCURRED_AT,
  PORTAL,
  PROPERTY,
  RECIPIENT,
  REVIEW,
  SCHEDULED_FOR,
  SETTLED_NOTIFICATION,
} from './notification-route-producer-fixtures'
/** The producer's commit, the outbox row's jsonb round trip, and the relay. */
export function deliveredEnvelope(fact: DomainEvent): ConsumerEvent {
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

export type RouteDeps = ReturnType<typeof createNotificationConsumerDeps> &
  Readonly<{
    receipts: Pick<OutboxRepository, 'insertReceipt'>
    escalationResolutions: EscalationResolutionLookupPort
    monthlyResultFacts: MonthlyResultNotificationFactsLookup
    googleConnectionProperties: GoogleConnectionPropertyLookup
    notifications: {
      settleUnreadForResource: ReturnType<
        typeof vi.fn<
          (
            input: Parameters<NotificationRepositoryPort['settleUnreadForResource']>[0],
          ) => Promise<ReadonlyArray<NotificationId>>
        >
      >
      settleUnreadForProperty: ReturnType<
        typeof vi.fn<
          (
            input: Parameters<NotificationRepositoryPort['settleUnreadForProperty']>[0],
          ) => Promise<ReadonlyArray<NotificationId>>
        >
      >
      findRecipientsOfNotice: ReturnType<
        typeof vi.fn<() => Promise<ReadonlyArray<UserId>>>
      >
    }
    emails: {
      cancelQueuedForNotifications: ReturnType<
        typeof vi.fn<
          (
            ids: ReadonlyArray<NotificationId>,
            orgId: OrganizationId,
            reason: string,
            at: Date,
          ) => Promise<number>
        >
      >
    }
    importInitiators: PropertyImportInitiatorLookup
    destinations: Pick<PortalPublicApi, 'findDestinationApprovalNotificationFacts'>
    workState: ReturnType<typeof waitingWorkState>
    groupedReopens: ReturnType<typeof noGroupedReopens>
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
    notifications: {
      settleUnreadForResource: vi.fn(async () => []),
      settleUnreadForProperty: vi.fn(async () => []),
      findRecipientsOfNotice: vi.fn(async () => []),
    },
    emails: { cancelQueuedForNotifications: vi.fn(async () => 0) },
    importInitiators: { findPropertyImportInitiator: vi.fn(async () => null) },
    destinations: { findDestinationApprovalNotificationFacts: vi.fn(async () => null) },
    workState: waitingWorkState(),
    groupedReopens: noGroupedReopens(),
  }
}

/** Every notification consumer the worker registers, over the given reads. */
export function registerNotificationRoutes(
  deps: RouteDeps = inertRouteDeps(),
): ConsumerRegistry {
  const registry = createConsumerRegistry()
  registerIdentityAccountNotificationConsumers(registry, deps)
  registerNotificationConsumers(registry, deps)
  registerWorkflowNotificationConsumers(registry, deps)
  registerBulkAssignmentNotificationConsumer(registry, deps)
  registerAssignmentReleaseNotificationConsumer(registry, deps)
  registerEscalationResolutionNotificationConsumer(registry, deps)
  registerHandlingCycleNotificationConsumers(registry, deps)
  registerNotificationSettlementConsumers(registry, deps)
  registerResponseTargetNotificationConsumer(registry, deps)
  registerGoalNotificationConsumer(registry, deps)
  registerRatingGoalNoticeConsumer(registry, deps)
  registerAiUrgentReviewNoticeConsumer(registry, deps)
  registerAiGuestVoiceSummaryNoticeConsumer(registry, deps)
  registerPortalNotificationConsumers(registry, deps)
  registerPortalDestinationNotificationConsumer(registry, deps)
  registerPortalHealthNotificationConsumer(registry, deps)
  registerPropertyNotificationConsumers(registry, deps)
  registerIntegrationNotificationConsumers(registry, deps)
  registerReviewImportNotificationConsumers(registry, deps)
  return registry
}

/** Reads that find each route's subject still current, so every route has work. */
export function currentRouteDeps(): RouteDeps {
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
    periodMonth: '2026-10',
    subject: { kind: 'property', propertyId: PROPERTY },
    setDuringMonth: false,
    targetChangedInMonth: false,
    metric: 'portal_rating_count',
    value: 41,
    target: 40,
    subjectName: null,
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
    dueAt: SCHEDULED_FOR,
  })
  return {
    ...deps,
    escalationResolutions: {
      findEscalationResolutionFacts: vi.fn(async () => ({
        propertyId: PROPERTY,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        isEscalated: false,
        escalatedAt: null,
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
    notifications: {
      settleUnreadForResource: vi.fn(async () => [SETTLED_NOTIFICATION]),
      settleUnreadForProperty: vi.fn(async () => [SETTLED_NOTIFICATION]),
      findRecipientsOfNotice: vi.fn(async () => []),
    },
    emails: { cancelQueuedForNotifications: vi.fn(async () => 1) },
    importInitiators: {
      findPropertyImportInitiator: vi.fn(async () => RECIPIENT as string),
    },
    destinations: {
      findDestinationApprovalNotificationFacts: vi.fn(async () => ({
        propertyId: PROPERTY,
        hostname: 'menu.example.com',
        approvalState: 'pending' as const,
        requestedBy: MANAGER,
        portal: { id: PORTAL, name: 'Lobby' },
        otherPortalCount: 0,
      })),
    },
  }
}

export type Receipt = Readonly<{ eventId: string; consumerName: string; status: string }>

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
export async function dispatch(
  fact: DomainEvent,
  deps: RouteDeps = currentRouteDeps(),
  options: Readonly<{
    outbox?: Pick<OutboxRepository, 'hasReceipt' | 'insertReceipt'>
    envelope?: ConsumerEvent
    omitConsumer?: string
  }> = {},
) {
  const receipts: Receipt[] = []
  const gateDenials: Receipt[] = []
  const recordReceipt: OutboxRepository['insertReceipt'] = async (...args) => {
    await options.outbox?.insertReceipt(...args)
    await recordInto(receipts)(...args)
  }
  const queued: InsertNotificationJobData[] = []
  const recordingQueue = {
    add: async (_name: string, data: unknown) => {
      queued.push(data as InsertNotificationJobData)
    },
  }
  const registered = registerNotificationRoutes({
    ...deps,
    queue: withBetaOutboxNotificationDelivery(recordingQueue, {
      insertReceipt: recordReceipt,
    }) as RouteDeps['queue'],
    receipts: { insertReceipt: recordReceipt },
  })
  const registry = createConsumerRegistry()
  for (const registration of registered.listFor(fact._tag)) {
    if (registration.consumerName !== options.omitConsumer) {
      registry.registerConsumer(registration)
    }
  }
  const envelope = options.envelope ?? deliveredEnvelope(fact)
  const repo = {
    hasReceipt: options.outbox?.hasReceipt ?? (async () => false),
    insertReceipt: async (...args: Parameters<OutboxRepository['insertReceipt']>) => {
      await options.outbox?.insertReceipt(...args)
      await recordInto(gateDenials)(...args)
    },
  } as unknown as OutboxRepository

  await createDispatcherHandler(repo, { consumers: registry })({
    id: envelope.eventId,
    name: envelope.eventType,
    data: envelope,
  } as unknown as Job)

  return { envelope, receipts, gateDenials, queued }
}

/** Used unchanged by ordinary routes and the missing-consumer negative control. */
export function expectAnnouncingRoute(
  route: BetaNotificationTriggerMatrixRow,
  result: Awaited<ReturnType<typeof dispatch>>,
  expectedTypes: ReadonlyArray<string> = route.notifications.map(({ type }) => type),
) {
  expect(result.gateDenials).toEqual([])
  expect(result.receipts).toContainEqual({
    eventId: result.envelope.eventId,
    consumerName: route.consumerName,
    status: 'applied',
  })
  const jobs = result.queued.filter(
    (job) => parseOutboxNotificationDelivery(job)?.consumerName === route.consumerName,
  )
  expect(jobs.length).toBeGreaterThan(0)
  for (const job of jobs) {
    expect(route.notifications.map(({ type }) => type)).toContain(job.type)
  }
  expect(new Set(jobs.map(({ type }) => type))).toEqual(new Set(expectedTypes))
  return jobs
}
