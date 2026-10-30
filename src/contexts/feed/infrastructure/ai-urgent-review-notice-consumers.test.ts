import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inboxItemId, organizationId, userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { ConsumerEvent } from '#/shared/outbox'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import {
  FRESHNESS_HORIZON_MS,
  handleAiReviewUrgentDetected,
  ON_AI_REVIEW_URGENT_DETECTED_CONSUMER,
  PROJECTION_HORIZON_MS,
  registerAiUrgentReviewNoticeConsumer,
} from './ai-urgent-review-notice-consumers'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'

const IDS = {
  event: '93000000-0000-4000-8000-000000000001',
  property: '93000000-0000-4000-8000-000000000002',
  review: '93000000-0000-4000-8000-000000000003',
  item: '93000000-0000-4000-8000-000000000004',
} as const
const ORG = 'organization-urgent-alert'
const NOW = new Date('2026-10-30T08:00:00.000Z')
const MANAGER = userId('manager-urgent-alert')
const SECOND_MANAGER = userId('manager-urgent-alert-2')
const ADMIN = userId('admin-urgent-alert')

const event = (
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: IDS.event,
  eventType: 'ai.review_analysis.urgent_detected',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: IDS.property,
    reviewId: IDS.review,
    sourceEpoch: 0,
    sourceRevision: 3,
    analysisSequence: 7,
    occurredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: IDS.property,
  sourceContext: 'ai',
  sourceAggregateId: IDS.review,
  recordedAt: NOW.toISOString(),
  ...envelopeOverrides,
})

/** An Inbox that holds the review's item open at the revision the fact names. */
const makeDeps = () => {
  const base = createNotificationConsumerDeps()
  const receipts: Array<[string, string, string]> = []
  const deps = {
    ...base,
    clock: () => NOW,
    receipts: {
      insertReceipt: async (eventId: string, consumer: string, status: string) => {
        receipts.push([eventId, consumer, status])
      },
    },
  }
  base.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(inboxItemId(IDS.item))
  base.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
    propertyId: IDS.property,
    portalId: null,
    assignedTo: null,
    propertyName: 'Seaview Hotel',
    guestRating: null,
    sourceType: 'review',
    sourceId: IDS.review,
    createdAt: new Date(NOW.getTime() - 3_600_000),
    currentCycleNumber: 1,
    currentSourceRevision: 3,
    stateRevision: 2,
    status: 'open',
  })
  base.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
    propertyId: IDS.property,
    portalId: null,
    assignedTo: null,
    propertyName: 'Seaview Hotel',
    guestRating: null,
    sourceType: 'review',
    createdAt: new Date(NOW.getTime() - 3_600_000),
  })
  base.inboxItemLookup.findWaitingSince.mockResolvedValue(
    new Date(NOW.getTime() - 3 * 3_600_000),
  )
  base.responsibleManagers.findForProperty.mockResolvedValue([MANAGER, SECOND_MANAGER])
  base.userLookup.findByRole.mockResolvedValue([ADMIN])
  return { base, deps, receipts }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(() => {
  clearEventSchemas()
})

describe('the Urgent alert route', () => {
  it('registers the one fact the AI context writes per review revision', () => {
    const registry = createConsumerRegistry()
    const { deps } = makeDeps()

    registerAiUrgentReviewNoticeConsumer(registry, deps)

    expect(registry.list()).toEqual([
      {
        eventType: 'ai.review_analysis.urgent_detected',
        consumerName: ON_AI_REVIEW_URGENT_DETECTED_CONSUMER,
      },
    ])
  })

  it('queues one urgent notice per responsible manager, keyed by the fact, then records its receipt', async () => {
    const { base, deps, receipts } = makeDeps()

    await expect(handleAiReviewUrgentDetected(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(base.jobs.map(({ name, opts }) => ({ name, opts }))).toEqual(
      [MANAGER, SECOND_MANAGER].map((recipient) => ({
        name: 'insert-notification',
        opts: { jobId: `${IDS.event}-${recipient}` },
      })),
    )
    for (const job of base.jobs) {
      expect(job.data).toMatchObject({
        organizationId: ORG,
        propertyId: IDS.property,
        type: 'review.ai_urgent_detected',
        resourceType: 'inbox_item',
        resourceId: IDS.item,
        eventId: IDS.event,
        audience: { kind: 'responsible_scope', scope: { kind: 'property' } },
      })
    }
    expect(receipts).toEqual([
      [IDS.event, ON_AI_REVIEW_URGENT_DETECTED_CONSUMER, 'applied'],
    ])
  })

  it('says only where and how long: the payload carries no reason, topic, rating or word of the review', async () => {
    const { base, deps } = makeDeps()

    await handleAiReviewUrgentDetected(deps, event())

    const data = base.jobs[0]?.data as { payload: Record<string, unknown> }
    expect(Object.keys(data.payload).sort()).toEqual([
      'platform',
      'propertyName',
      'waitingSince',
    ])
    const rendered = renderNotification(
      'review.ai_urgent_detected',
      parseNotificationPayload(data.payload),
    )
    expect(rendered.title).toBe('An urgent review needs you at Seaview Hotel')
    expect(JSON.stringify(rendered)).not.toMatch(
      /safety|health|discriminat|legal|star|rating/i,
    )
  })

  it('falls back to the Property’s AccountAdmins when nobody is responsible', async () => {
    const { base, deps } = makeDeps()
    base.responsibleManagers.findForProperty.mockResolvedValue([])

    await handleAiReviewUrgentDetected(deps, event())

    expect(base.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      ADMIN,
    ])
  })

  it('does not reach the assignee or the people who wrote notes: only who receives review notifications', async () => {
    const { base, deps } = makeDeps()
    base.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: IDS.property,
      portalId: null,
      assignedTo: userId('assignee-urgent-alert'),
      propertyName: 'Seaview Hotel',
      guestRating: null,
      sourceType: 'review',
      createdAt: NOW,
    })
    base.inboxItemLookup.findNoteAuthors.mockResolvedValue([
      userId('author-urgent-alert'),
    ])

    await handleAiReviewUrgentDetected(deps, event())

    expect(
      base.jobs.map((job) => (job.data as { userId: string }).userId).sort(),
    ).toEqual([MANAGER, SECOND_MANAGER].sort())
  })

  describe.each([
    {
      why: 'the item is closed (somebody handled it)',
      arrange: (b: ReturnType<typeof makeDeps>['base']) =>
        b.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
          propertyId: IDS.property,
          portalId: null,
          assignedTo: null,
          propertyName: 'Seaview Hotel',
          guestRating: null,
          sourceType: 'review',
          sourceId: IDS.review,
          createdAt: NOW,
          currentCycleNumber: 1,
          currentSourceRevision: 3,
          stateRevision: 2,
          status: 'closed',
        }),
    },
    {
      why: 'the guest has since changed the review (a newer revision has its own alert)',
      arrange: (b: ReturnType<typeof makeDeps>['base']) =>
        b.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
          propertyId: IDS.property,
          portalId: null,
          assignedTo: null,
          propertyName: 'Seaview Hotel',
          guestRating: null,
          sourceType: 'review',
          sourceId: IDS.review,
          createdAt: NOW,
          currentCycleNumber: 2,
          currentSourceRevision: 4,
          stateRevision: 2,
          status: 'open',
        }),
    },
    {
      why: 'the item arrived as imported Google history',
      arrange: (b: ReturnType<typeof makeDeps>['base']) =>
        b.inboxItemLookup.isHistoricalOnboardingItem.mockResolvedValue(true),
    },
    {
      why: 'the item has waited longer than a week (a replay of old reviews)',
      arrange: (b: ReturnType<typeof makeDeps>['base']) =>
        b.inboxItemLookup.findWaitingSince.mockResolvedValue(
          new Date(NOW.getTime() - FRESHNESS_HORIZON_MS - 1),
        ),
    },
    {
      why: 'the item is private feedback, not a review',
      arrange: (b: ReturnType<typeof makeDeps>['base']) =>
        b.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
          propertyId: IDS.property,
          portalId: null,
          assignedTo: null,
          propertyName: 'Seaview Hotel',
          guestRating: null,
          sourceType: 'feedback',
          sourceId: IDS.review,
          createdAt: NOW,
          currentCycleNumber: 1,
          currentSourceRevision: 3,
          stateRevision: 2,
          status: 'open',
        }),
    },
    {
      why: 'the item belongs to another Property than the fact names',
      arrange: (b: ReturnType<typeof makeDeps>['base']) =>
        b.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
          propertyId: 'another-property',
          portalId: null,
          assignedTo: null,
          propertyName: 'Elsewhere',
          guestRating: null,
          sourceType: 'review',
          sourceId: IDS.review,
          createdAt: NOW,
          currentCycleNumber: 1,
          currentSourceRevision: 3,
          stateRevision: 2,
          status: 'open',
        }),
    },
  ])('stays silent when $why', ({ arrange }) => {
    it('writes an obsolete receipt and queues nothing', async () => {
      const { base, deps, receipts } = makeDeps()
      arrange(base)

      await expect(handleAiReviewUrgentDetected(deps, event())).resolves.toEqual({
        status: 'obsolete',
      })

      expect(base.jobs).toEqual([])
      expect(receipts).toEqual([
        [IDS.event, ON_AI_REVIEW_URGENT_DETECTED_CONSUMER, 'obsolete'],
      ])
    })
  })

  it('still announces a review that has waited just under a week', async () => {
    const { base, deps } = makeDeps()
    base.inboxItemLookup.findWaitingSince.mockResolvedValue(
      new Date(NOW.getTime() - FRESHNESS_HORIZON_MS + 60_000),
    )

    await expect(handleAiReviewUrgentDetected(deps, event())).resolves.toEqual({
      status: 'applied',
    })
    expect(base.jobs).toHaveLength(2)
  })

  it('announces an item whose wait is not measured (it never counts as stale)', async () => {
    const { base, deps } = makeDeps()
    base.inboxItemLookup.findWaitingSince.mockResolvedValue(null)

    await expect(handleAiReviewUrgentDetected(deps, event())).resolves.toEqual({
      status: 'applied',
    })
  })

  it('gives up with an obsolete receipt when nobody is left to tell', async () => {
    const { base, deps, receipts } = makeDeps()
    base.responsibleManagers.findForProperty.mockResolvedValue([])
    base.userLookup.findByRole.mockResolvedValue([])

    await expect(handleAiReviewUrgentDetected(deps, event())).resolves.toEqual({
      status: 'obsolete',
    })

    expect(base.jobs).toEqual([])
    expect(receipts).toHaveLength(1)
    expect(base.logger.warn).toHaveBeenCalled()
  })

  describe('while the Inbox has not projected the review yet', () => {
    it('throws, so the dispatch retries, when the item does not exist yet', async () => {
      const { base, deps, receipts } = makeDeps()
      base.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(null)

      await expect(handleAiReviewUrgentDetected(deps, event())).rejects.toThrow(
        /waits for the Inbox/,
      )

      expect(receipts).toEqual([])
      expect(base.jobs).toEqual([])
    })

    it('throws when the item still stands at an earlier revision', async () => {
      const { base, deps } = makeDeps()
      base.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
        propertyId: IDS.property,
        portalId: null,
        assignedTo: null,
        propertyName: 'Seaview Hotel',
        guestRating: null,
        sourceType: 'review',
        sourceId: IDS.review,
        createdAt: NOW,
        currentCycleNumber: 1,
        currentSourceRevision: 2,
        stateRevision: 1,
        status: 'open',
      })

      await expect(handleAiReviewUrgentDetected(deps, event())).rejects.toThrow(
        /waits for the Inbox/,
      )
    })

    it('drops the alert as obsolete once the horizon has passed', async () => {
      const { base, deps, receipts } = makeDeps()
      base.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(null)

      await expect(
        handleAiReviewUrgentDetected(
          deps,
          event({
            occurredAt: new Date(NOW.getTime() - PROJECTION_HORIZON_MS - 1).toISOString(),
          }),
        ),
      ).resolves.toEqual({ status: 'obsolete' })

      expect(receipts).toEqual([
        [IDS.event, ON_AI_REVIEW_URGENT_DETECTED_CONSUMER, 'obsolete'],
      ])
    })
  })

  describe('refuses a fact it cannot trust', () => {
    it('rejects a different event type', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiReviewUrgentDetected(deps, event({}, { eventType: 'review.created' })),
      ).rejects.toThrow(/wrong event type/)
    })

    it('rejects an envelope that names another Organization', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiReviewUrgentDetected(deps, event({}, { organizationId: 'other-org' })),
      ).rejects.toThrow(/attribution mismatch/)
    })

    it('rejects a payload without a review revision', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiReviewUrgentDetected(deps, event({ sourceRevision: 0 })),
      ).rejects.toThrow()
    })
  })

  it('asks the Inbox about this Organization’s review, nothing broader', async () => {
    const { base, deps } = makeDeps()

    await handleAiReviewUrgentDetected(deps, event())

    expect(base.inboxItemLookup.findInboxItemByReviewId).toHaveBeenCalledWith(
      IDS.review,
      organizationId(ORG),
    )
  })
})
