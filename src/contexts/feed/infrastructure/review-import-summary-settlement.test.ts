// The import summary's "N still need a reply" is only true once every
// review.created / review.updated / review.reply.observed the import wrote has
// reached the Inbox. Those projections run concurrently with the finished fact
// and retry on their own backoff, so the summary waits for them — and past its
// horizon drops the number rather than state a wrong one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { propertyId, unbrand } from '#/shared/domain/ids'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import {
  handleNotificationReviewHistoryImportFinished,
  REVIEW_IMPORT_SUMMARY_SETTLE_HORIZON_MS,
} from './review-import-outbox-consumers'

const EVENT_ID = '30000000-0000-4000-8000-000000000041'
const RUN_ID = '30000000-0000-4000-8000-000000000042'
const PROPERTY = propertyId('30000000-0000-4000-8000-000000000043')
const RECORDED_AT = new Date('2026-06-01T12:00:00.000Z')

const event = (): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'review.property_history_import.finished',
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(PROPERTY),
    sourceEpoch: 0,
    runId: RUN_ID,
    outcome: 'completed',
    reviewsObserved: 40,
    failureReason: null,
    occurredAt: RECORDED_AT.toISOString(),
    sourceAggregateVersion: RECORDED_AT.toISOString(),
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(PROPERTY),
  sourceContext: 'review',
  sourceAggregateId: RUN_ID,
  recordedAt: RECORDED_AT.toISOString(),
})

const makeDeps = (now: Date) => {
  const fakes = createNotificationConsumerDeps()
  fakes.inboxItemLookup.countOpenReviewItemsForProperty.mockResolvedValue(38)
  fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
  const hasPendingReviewProjections = vi.fn(
    async (_property: string, _org: unknown, _before: Date) => true,
  )
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: {
      countOpenReviewItemsForProperty:
        fakes.inboxItemLookup.countOpenReviewItemsForProperty,
      hasPendingReviewProjections,
    },
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    importInitiators: { findPropertyImportInitiator: vi.fn(async () => null) },
    receipts: { insertReceipt: vi.fn(async () => {}) },
    clock: () => now,
    fakes,
    hasPendingReviewProjections,
  }
}

describe('import summary waits for its Inbox projections', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => clearEventSchemas())

  it('retries instead of counting while the import is still reaching the Inbox', async () => {
    const deps = makeDeps(new Date(RECORDED_AT.getTime() + 5_000))

    await expect(
      handleNotificationReviewHistoryImportFinished(deps, event()),
    ).rejects.toThrow(/still reaching the Inbox/)

    expect(deps.hasPendingReviewProjections).toHaveBeenCalledWith(
      unbrand(PROPERTY),
      NOTIF_TEST_IDS.orgId,
      RECORDED_AT,
    )
    expect(deps.fakes.jobs).toHaveLength(0)
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('counts once the projections have settled', async () => {
    const deps = makeDeps(new Date(RECORDED_AT.getTime() + 5_000))
    deps.hasPendingReviewProjections.mockResolvedValue(false)

    await handleNotificationReviewHistoryImportFinished(deps, event())

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      payload: { importedCount: 40, unansweredCount: 38 },
    })
  })

  it('past its horizon announces the import without a number it cannot vouch for', async () => {
    const deps = makeDeps(
      new Date(RECORDED_AT.getTime() + REVIEW_IMPORT_SUMMARY_SETTLE_HORIZON_MS),
    )

    await handleNotificationReviewHistoryImportFinished(deps, event())

    const payload = (deps.fakes.jobs[0]?.data as { payload: Record<string, unknown> })
      .payload
    expect(payload).toMatchObject({ importedCount: 40 })
    expect(payload).not.toHaveProperty('unansweredCount')
  })
})
