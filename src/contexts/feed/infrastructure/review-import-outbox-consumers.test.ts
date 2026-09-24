import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { propertyId, unbrand, userId } from '#/shared/domain/ids'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import {
  handleNotificationReviewHistoryImportFinished,
  ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
  registerReviewImportNotificationConsumers,
} from './review-import-outbox-consumers'

let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '30000000-0000-4000-8000-000000000031'
const RUN_ID = '30000000-0000-4000-8000-000000000032'
const IMPORTER = userId('importer-1')
// The fact's Property is a database UUID: its schema says so, and a consumer
// test that used the short fixture id would never have reached the handler.
const PROPERTY = propertyId('30000000-0000-4000-8000-000000000033')

const event = (
  payload: Readonly<Record<string, unknown>> = {},
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'review.property_history_import.finished',
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(PROPERTY),
    sourceEpoch: 0,
    runId: RUN_ID,
    outcome: 'completed',
    reviewsObserved: 260,
    failureReason: null,
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
    sourceAggregateVersion: NOTIF_TEST_IDS.now.toISOString(),
    ...payload,
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(PROPERTY),
  sourceContext: 'review',
  sourceAggregateId: RUN_ID,
  recordedAt: '2026-06-01T11:59:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  fakes.inboxItemLookup.countOpenReviewItemsForProperty.mockResolvedValue(254)
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: fakes.inboxItemLookup,
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    importInitiators: {
      findPropertyImportInitiator: vi.fn(async () => null as string | null),
    },
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

describe('review history import notification consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers under its own consumer identity', () => {
    registerReviewImportNotificationConsumers(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'review.property_history_import.finished',
      consumerName: ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
    })
  })

  it('tells the person who asked for the import what it brought in', async () => {
    const deps = makeDeps()
    deps.importInitiators.findPropertyImportInitiator.mockResolvedValue(unbrand(IMPORTER))

    await expect(
      handleNotificationReviewHistoryImportFinished(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs).toHaveLength(1)
    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      userId: IMPORTER,
      type: 'property.review_import_finished',
      resourceType: 'property',
      resourceId: unbrand(PROPERTY),
      payload: {
        propertyName: 'Riverside Hotel',
        importOutcome: 'completed',
        importedCount: 260,
        unansweredCount: 254,
      },
      audience: { kind: 'property_operator' },
    })
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
      'applied',
    )
  })

  it("falls back to the Property's responsible managers when nobody is recorded", async () => {
    const deps = makeDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await handleNotificationReviewHistoryImportFinished(deps, event())

    expect(deps.fakes.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual(
      [NOTIF_TEST_IDS.manager1, NOTIF_TEST_IDS.manager2],
    )
    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: unbrand(PROPERTY) },
      },
    })
  })

  it('falls back to AccountAdmins when the Property has no responsible manager', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationReviewHistoryImportFinished(deps, event())

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      userId: NOTIF_TEST_IDS.admin1,
      audience: { kind: 'account_admin' },
    })
  })

  it('counts what is still unanswered when the notice is built, at that Property', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationReviewHistoryImportFinished(deps, event())

    expect(
      deps.fakes.inboxItemLookup.countOpenReviewItemsForProperty,
    ).toHaveBeenCalledWith(unbrand(PROPERTY), NOTIF_TEST_IDS.orgId)
  })

  it('carries the closed reason of a stopped import and no counts to reply to', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationReviewHistoryImportFinished(
      deps,
      event({
        outcome: 'failed',
        reviewsObserved: 12,
        failureReason: 'google_authorization',
      }),
    )

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      payload: {
        importOutcome: 'failed',
        importFailureReason: 'google_authorization',
        importedCount: 12,
      },
    })
    expect(
      (deps.fakes.jobs[0]?.data as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('unansweredCount')
  })

  it('says nothing about a failure RepKey is already retrying', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await expect(
      handleNotificationReviewHistoryImportFinished(
        deps,
        event({ outcome: 'failed', reviewsObserved: 3, failureReason: 'temporary' }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(deps.fakes.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
      'obsolete',
    )
  })

  it('still announces the import when the unanswered count cannot be read', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    deps.fakes.inboxItemLookup.countOpenReviewItemsForProperty.mockRejectedValue(
      new Error('db down'),
    )

    await handleNotificationReviewHistoryImportFinished(deps, event())

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      payload: { importOutcome: 'completed', importedCount: 260 },
    })
  })

  it('fails closed on Organization or Property attribution mismatch', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationReviewHistoryImportFinished(
        deps,
        event({}, { organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
