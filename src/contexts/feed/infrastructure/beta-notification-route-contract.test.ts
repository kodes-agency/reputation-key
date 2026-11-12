// Notification acceptance examples use real producers and the worker dispatcher.
import {
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  inboxItemAssigned,
} from '#/contexts/inbox/domain/events'
import {
  portalHealthChanged,
  portalResponsibleManagersUpdated,
} from '#/contexts/portal/domain/events'
import { propertyResponsibleManagersUpdated } from '#/contexts/property/domain/events'
import {
  goalMonthlyResultClosed,
  goalMonthlyResultRevised,
} from '#/contexts/reporting/domain/goal-events'
import { reviewPropertyHistoryImportFinished } from '#/contexts/review/domain/events'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createJobExecutionEnvelope,
  gateDispatcherConsumer,
  gateJob,
} from '#/shared/jobs/delayed-execution-gate'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertBetaNotificationTriggerMatrix,
  BETA_NOTIFICATION_TRIGGER_MATRIX,
} from '../application/beta-notification-trigger-matrix'
import {
  createNotificationAudienceAuthorizer,
  parseNotificationAudience,
} from '../application/notification-audience'
import type { NotificationType } from '../domain/notification-types'
import {
  MANDATORY_EMAIL_JOB_NAME,
  URGENT_EMAIL_JOB_NAME,
} from '../email/send-emails.server'

import {
  ACTOR,
  ADMIN,
  BULK,
  destinationUpdated,
  GOAL,
  handlingCycleScope,
  ITEM,
  OCCURRED_AT,
  ORG,
  PORTAL,
  PRODUCED_FACTS,
  PROPERTY,
  RECIPIENT,
  REVIEW,
  SETTLED_NOTIFICATION,
  SETTLED_RESOURCE,
  SETTLING_FACTS,
  SNAPSHOT_RUN,
} from '#/shared/testing/notification-route-producer-fixtures'
import {
  currentRouteDeps,
  deliveredEnvelope,
  dispatch,
  expectAnnouncingRoute,
  registerNotificationRoutes,
  type RouteDeps,
} from '#/shared/testing/notification-route-test-harness'

/** The immediate-email job a written notice queues, with its execution envelope. */
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
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
})

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('every beta notification route passes the delayed execution gate', () => {
  it('matches the registered notification consumers to the trigger matrix', () => {
    expect(() =>
      assertBetaNotificationTriggerMatrix(registerNotificationRoutes().list()),
    ).not.toThrow()
  })

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

  it('sends a mandatory notice while optional email is switched off', async () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'optional_email' }),
    )

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
    // ordinary product mail waits for the switch.
    expect(mandatoryNotice.decision.reason).toBe('allowed')
    expect(optionalNotice.decision.reason).toBe('capability_disabled')
  })

  it('still stops mandatory mail for the environment stop and for a suspended tenant', async () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_SUSPENDED_ORGS: ORG }),
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
  'inbox.inbox_item.assigned': {
    fact: () =>
      inboxItemAssigned({
        inboxItemId: ITEM,
        organizationId: ORG,
        propertyId: PROPERTY,
        assignedTo: RECIPIENT,
        userId: ACTOR,
        bulkId: BULK,
        source: 'web',
        occurredAt: OCCURRED_AT,
      }),
    status: 'applied',
  },
  'property.responsible_managers.updated': {
    fact: () =>
      propertyResponsibleManagersUpdated({
        organizationId: ORG,
        propertyId: PROPERTY,
        assignmentCount: 0,
        occurredAt: OCCURRED_AT,
      }),
    status: 'applied',
  },
  'portal.responsible_managers.updated': {
    fact: () =>
      portalResponsibleManagersUpdated({
        portalId: PORTAL,
        organizationId: ORG,
        propertyId: PROPERTY,
        assignmentCount: 0,
        sourceAggregateVersion: OCCURRED_AT.toISOString(),
        occurredAt: OCCURRED_AT,
      }),
    status: 'applied',
  },
  // A stopped import RepKey retries by itself reaches nobody.
  'review.property_history_import.finished': {
    fact: () =>
      reviewPropertyHistoryImportFinished({
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: 0,
        runId: SNAPSHOT_RUN,
        outcome: 'failed',
        reviewsObserved: 3,
        failureReason: 'temporary',
        occurredAt: OCCURRED_AT,
      }),
    status: 'obsolete',
  },
  // A decision is the settlement route's, not news.
  'portal.approved_destination.updated': {
    fact: () => destinationUpdated('approved'),
    status: 'obsolete',
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
  // Somebody handled the review before the alert was read: nothing is left to ask.
  'ai.review_analysis.urgent_detected': {
    fact: () => PRODUCED_FACTS['ai.review_analysis.urgent_detected']!(),
    status: 'obsolete',
    arrange: (deps) =>
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
        propertyId: PROPERTY,
        portalId: null,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        guestRating: null,
        sourceType: 'review',
        createdAt: OCCURRED_AT,
        sourceId: REVIEW,
        currentCycleNumber: handlingCycleScope.cycleNumber,
        currentSourceRevision: handlingCycleScope.sourceRevision,
        stateRevision: handlingCycleScope.stateRevision,
        status: 'closed',
      }),
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

// These facts choose one type; a reassignment instead must emit both branches.
const SELECTED_FACT_TYPES: Readonly<Record<string, ReadonlyArray<NotificationType>>> = {
  'inbox.inbox_item.created': ['review.created'],
  'inbox.response_target.reminder_due': ['inbox.response_target_passed'],
  'goal.rating_goal.transitioned': ['goal.rating_below_pace'],
}

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

  for (const route of BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
    (candidate) => candidate.settles !== undefined,
  )) {
    it(`${route.eventType}: ${route.consumerName} retires its notices durably`, async () => {
      const deps = currentRouteDeps()

      const { envelope, receipts, gateDenials, queued } = await dispatch(
        (SETTLING_FACTS[route.consumerName] ?? PRODUCED_FACTS[route.eventType])!(),
        deps,
      )

      // A settling route announces nothing; it retires the notices that
      // asked for the work, and cancels the mail queued behind them.
      expect(gateDenials).toEqual([])
      expect(queued.filter((job) => (route.settles ?? []).includes(job.type))).toEqual([])
      // An archive settles everything on its Property rather than one resource.
      if (route.eventType === 'property.archived') {
        expect(deps.notifications.settleUnreadForProperty).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: envelope.organizationId,
            propertyId: PROPERTY,
            types: route.settles,
          }),
        )
      } else {
        expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: envelope.organizationId,
            types: route.settles,
            resourceId: SETTLED_RESOURCE[route.eventType] ?? ITEM,
          }),
        )
      }
      expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalledWith(
        [SETTLED_NOTIFICATION],
        envelope.organizationId,
        expect.any(String),
        expect.any(Date),
      )
      expect(receipts).toContainEqual({
        eventId: envelope.eventId,
        consumerName: route.consumerName,
        status: 'applied',
      })
    })
  }

  for (const route of BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
    (candidate) => candidate.settles === undefined,
  )) {
    it(`${route.eventType}: ${route.consumerName} writes its notification durably`, async () => {
      const result = await dispatch(PRODUCED_FACTS[route.eventType]!())
      const { envelope } = result
      const queued = expectAnnouncingRoute(
        route,
        result,
        SELECTED_FACT_TYPES[route.eventType],
      )
      for (const job of queued) {
        expect(job).toMatchObject({
          eventId: envelope.eventId,
          consumerName: route.consumerName,
        })
        expect(parseNotificationAudience(job.audience), job.type).not.toBeNull()
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
 * The inviter's notice rides the new member's fact and reaches one person, the
 * AccountAdmin who sent the invitation. It has no Property and is decided by
 * the role alone, so an inviter who has since left, or an operator who never
 * held the role in this Organization, is refused when the job is delivered.
 */
describe('the accepted-invitation notice reaches only its inviter, while they are an AccountAdmin', () => {
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

  const inviterJobs = async (deps: RouteDeps) => {
    const { queued } = await dispatch(
      PRODUCED_FACTS['identity.invitation.accepted']!(),
      deps,
    )
    return queued.filter((job) => job.type === 'account.invitation_accepted')
  }

  it('queues one job, for the inviter and never the person who joined', async () => {
    const jobs = await inviterJobs(currentRouteDeps())

    expect(jobs.map((job) => job.userId)).toEqual([ACTOR])
    expect(JSON.stringify(jobs)).not.toContain(RECIPIENT)
  })

  it('passes the delivery check while the inviter is still an AccountAdmin', async () => {
    const deps = currentRouteDeps()
    const jobs = await inviterJobs(deps)
    deps.userLookup.findByRole.mockResolvedValue([ACTOR])

    for (const job of jobs) {
      await expect(
        authorizerFor(deps)({
          userId: job.userId,
          organizationId: job.organizationId,
          propertyId: job.propertyId,
          audience: parseNotificationAudience(job.audience)!,
        }),
      ).resolves.toBe(true)
    }
  })

  it('refuses the notice for an inviter who has left or lost the role since', async () => {
    const deps = currentRouteDeps()
    const jobs = await inviterJobs(deps)
    deps.userLookup.findByRole.mockResolvedValue([ADMIN])

    expect(jobs).toHaveLength(1)
    for (const job of jobs) {
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
