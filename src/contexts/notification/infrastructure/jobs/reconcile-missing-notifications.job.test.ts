// Notification context — the notification-gap healing sweep.
//
// The fake gap repository below is not a stub: it applies the same rule the
// SQL does (return items in the window with NO notification row) against a
// `notified` set the fake queue fills in. That is what makes the idempotency
// and grace-period assertions mean something — a sweep that healed an item
// must not see it again, and an item the happy path has not had a chance at
// yet must never be seen at all.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import {
  createReconcileMissingNotificationsHandler,
  DEFAULT_RECONCILE_GRACE_MS,
  DEFAULT_RECONCILE_LOOKBACK_MS,
  JOB_NAME,
  NOTIFICATION_GAP_SCAN_LIMIT,
  type ReconcileMissingNotificationsDeps,
} from './reconcile-missing-notifications.job'
import type {
  MissingNotificationCandidate,
  NotificationGapRepositoryPort,
} from '../../application/ports/notification-gap.repository'
import { insertNotification } from '../../application/use-cases/insert-notification'
import type { InsertNotificationInput } from '../../application/use-cases/insert-notification'
import { buildFakeInsertNotificationDeps } from '../../application/use-cases/test-fixtures'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  NOTIF_TEST_IDS,
} from '../event-handlers/test-fixtures'
import { unbrand, type UserId } from '#/shared/domain/ids'
import type { NotificationPreference } from '../../domain/types'

vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    }),
  }
})

const NOW = new Date('2026-06-01T12:00:00.000Z')
const MINUTE = 60_000

/** One candidate, `ageMs` old relative to the fixed NOW. */
const item = (n: number, ageMs: number): MissingNotificationCandidate => ({
  inboxItemId: `item-${n}`,
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceType: 'review',
  createdAt: new Date(NOW.getTime() - ageMs),
})

/** Every window argument the sweep asked the repository for, in order. */
type RecordedQuery = Readonly<{
  createdAtOrAfter: Date
  createdBefore: Date
  cursor: Readonly<{ createdAt: Date; inboxItemId: string }> | null
  limit: number
}>

type FakeGapRepo = NotificationGapRepositoryPort &
  Readonly<{ queries: readonly RecordedQuery[] }>

/**
 * Gap repository over an in-memory item list. `notified` is the set of item ids
 * that already have a notification row — exactly the NOT EXISTS the real query
 * applies, so a healed item drops out of subsequent batches.
 */
const fakeGapRepo = (
  items: readonly MissingNotificationCandidate[],
  notified: Set<string>,
): FakeGapRepo => {
  const queries: RecordedQuery[] = []

  // The gap definition, in one place: inside the window, past the grace edge,
  // and no notification row yet.
  const isGap = (
    candidate: MissingNotificationCandidate,
    createdAtOrAfter: Date,
    createdBefore: Date,
  ) =>
    candidate.createdAt >= createdAtOrAfter &&
    candidate.createdAt < createdBefore &&
    !notified.has(candidate.inboxItemId)

  return {
    queries,
    findItemsMissingNotifications: async ({
      createdAtOrAfter,
      createdBefore,
      cursor,
      limit,
    }) => {
      queries.push({ createdAtOrAfter, createdBefore, cursor, limit })
      return [...items]
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.inboxItemId.localeCompare(b.inboxItemId),
        )
        .filter(
          (candidate) =>
            isGap(candidate, createdAtOrAfter, createdBefore) &&
            (cursor === null ||
              candidate.createdAt > cursor.createdAt ||
              (candidate.createdAt.getTime() === cursor.createdAt.getTime() &&
                candidate.inboxItemId > cursor.inboxItemId)),
        )
        .slice(0, limit)
    },
    countItemsMissingNotifications: async ({
      createdAtOrAfter,
      createdBefore,
      scanLimit,
    }) =>
      Math.min(
        items.filter((candidate) => isGap(candidate, createdAtOrAfter, createdBefore))
          .length,
        scanLimit,
      ),
  }
}

type Harness = Readonly<{
  handler: (job: Job) => Promise<void>
  fakes: FakeEventHandlerDeps
  gapRepo: FakeGapRepo
  notified: Set<string>
}>

const makeHarness = (
  items: readonly MissingNotificationCandidate[],
  overrides: Partial<ReconcileMissingNotificationsDeps> = {},
  recipients: readonly UserId[] = [NOTIF_TEST_IDS.manager1],
): Harness => {
  const fakes = createEventHandlerDeps()
  fakes.responsibleManagers.findForProperty.mockResolvedValue(recipients)
  const notified = new Set<string>()
  const gapRepo = fakeGapRepo(items, notified)

  // The fake queue stands in for the insert-notification worker: whatever it
  // accepts is a notification row that now exists.
  fakes.addMock.mockImplementation(
    async (name: string, data: unknown, opts?: unknown) => {
      fakes.jobs.push(opts === undefined ? { name, data } : { name, data, opts })
      if (data !== null && typeof data === 'object' && 'resourceId' in data) {
        const { resourceId } = data
        if (typeof resourceId === 'string') notified.add(resourceId)
      }
    },
  )

  const handler = createReconcileMissingNotificationsHandler({
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: fakes.inboxItemLookup,
    clock: () => NOW,
    logger: fakes.logger,
    gapRepo,
    ...overrides,
  })
  return { handler, fakes, gapRepo, notified }
}

const preference = (enabled: boolean): NotificationPreference => ({
  id: 'pref-1' as NotificationPreference['id'],
  userId: NOTIF_TEST_IDS.manager1,
  organizationId: NOTIF_TEST_IDS.orgId,
  propertyId: NOTIF_TEST_IDS.propId,
  category: 'workflow_collaboration',
  channel: 'email',
  enabled,
  cadence: 'daily',
  urgentBypassEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  createdAt: NOW,
  updatedAt: NOW,
})

const job = {} as Job

describe('reconcile-missing-notifications sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered under the job name the worker schedules', () => {
    expect(JOB_NAME).toBe('reconcile-missing-notifications')
  })

  it('enqueues the missing notification for an inbox item that never got one', async () => {
    const { handler, fakes } = makeHarness([item(1, 30 * MINUTE)])

    await handler(job)

    expect(fakes.jobs).toHaveLength(1)
    expect(fakes.jobs[0]!.data).toEqual(
      expect.objectContaining({
        userId: NOTIF_TEST_IDS.manager1,
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: 'item-1',
        eventId: 'reconcile:item-1',
      }),
    )
  })

  it('enqueues for every resolved recipient of the item', async () => {
    const { handler, fakes } = makeHarness([item(1, 30 * MINUTE)], {}, [
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await handler(job)

    expect(fakes.jobs.map((enqueued) => enqueued.data)).toEqual([
      expect.objectContaining({ userId: NOTIF_TEST_IDS.manager1 }),
      expect.objectContaining({ userId: NOTIF_TEST_IDS.manager2 }),
    ])
  })

  it('leaves an item that already has a notification untouched — a re-run duplicates nothing', async () => {
    const { handler, fakes, notified } = makeHarness([item(1, 30 * MINUTE)])

    await handler(job)
    expect(fakes.jobs).toHaveLength(1)
    expect(notified.has('item-1')).toBe(true)

    // Second firing: the item now has a notification, so it is not a candidate.
    await handler(job)
    expect(fakes.jobs).toHaveLength(1)
  })

  it('respects the grace period — an item too fresh to judge is never touched', async () => {
    const { handler, fakes, gapRepo } = makeHarness([
      item(1, 1 * MINUTE), // inside the grace edge
      item(2, 10 * MINUTE), // past it
    ])

    await handler(job)

    expect(fakes.jobs.map((enqueued) => enqueued.data)).toEqual([
      expect.objectContaining({ resourceId: 'item-2' }),
    ])
    expect(gapRepo.queries[0]).toEqual(
      expect.objectContaining({
        createdBefore: new Date(NOW.getTime() - DEFAULT_RECONCILE_GRACE_MS),
        createdAtOrAfter: new Date(NOW.getTime() - DEFAULT_RECONCILE_LOOKBACK_MS),
      }),
    )
  })

  it('ignores a gap older than the lookback window — a day-old review is no longer news', async () => {
    const { handler, fakes } = makeHarness([item(1, DEFAULT_RECONCILE_LOOKBACK_MS + 1)])

    await handler(job)

    expect(fakes.jobs).toHaveLength(0)
  })

  it('holds the batch budget: at most batchSize x maxBatches items per firing', async () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i, (i + 10) * MINUTE))
    const { handler, fakes, gapRepo } = makeHarness(items, {
      batchSize: 3,
      maxBatches: 2,
    })

    await handler(job)

    expect(fakes.jobs).toHaveLength(6)
    expect(gapRepo.queries).toHaveLength(2)
    expect(gapRepo.queries.every((query) => query.limit === 3)).toBe(true)
  })

  it('advances the keyset cursor across batches instead of re-reading the head', async () => {
    const items = [item(1, 30 * MINUTE), item(2, 20 * MINUTE), item(3, 10 * MINUTE)]
    const { handler, fakes, gapRepo } = makeHarness(items, {
      batchSize: 1,
      maxBatches: 3,
    })

    await handler(job)

    expect(fakes.jobs.map((enqueued) => enqueued.data)).toEqual([
      expect.objectContaining({ resourceId: 'item-1' }),
      expect.objectContaining({ resourceId: 'item-2' }),
      expect.objectContaining({ resourceId: 'item-3' }),
    ])
    expect(gapRepo.queries[0]!.cursor).toBeNull()
    expect(gapRepo.queries[1]!.cursor).toEqual({
      createdAt: items[0]!.createdAt,
      inboxItemId: 'item-1',
    })
  })

  it('does not let one failing item starve the rest, and still fails the firing', async () => {
    const { handler, fakes } = makeHarness([
      item(1, 30 * MINUTE),
      item(2, 20 * MINUTE),
      item(3, 10 * MINUTE),
    ])
    fakes.addMock.mockRejectedValueOnce(new Error('Queue unavailable'))

    await expect(handler(job)).rejects.toThrow(
      'reconcile-missing-notifications: 1 of 3 candidates failed to enqueue',
    )
    // items 2 and 3 were still attempted after item 1 blew up.
    expect(fakes.addMock).toHaveBeenCalledTimes(3)
  })

  it('counts the gap it claims to count, and saturates at the scan cap', async () => {
    const items = Array.from({ length: 3 }, (_, i) => item(i, (i + 10) * MINUTE))
    const notified = new Set<string>()
    const repo = fakeGapRepo(items, notified)
    const window = {
      createdAtOrAfter: new Date(NOW.getTime() - DEFAULT_RECONCILE_LOOKBACK_MS),
      createdBefore: new Date(NOW.getTime() - DEFAULT_RECONCILE_GRACE_MS),
    }

    await expect(
      repo.countItemsMissingNotifications({
        ...window,
        scanLimit: NOTIFICATION_GAP_SCAN_LIMIT,
      }),
    ).resolves.toBe(3)

    notified.add('item-0')
    await expect(
      repo.countItemsMissingNotifications({
        ...window,
        scanLimit: NOTIFICATION_GAP_SCAN_LIMIT,
      }),
    ).resolves.toBe(2)

    await expect(
      repo.countItemsMissingNotifications({ ...window, scanLimit: 1 }),
    ).resolves.toBe(1)
  })

  // Both channel-gate tests hand the sweep's own enqueued job data to
  // insertNotification; they differ in which channels the preference disables and
  // therefore in what they assert (in-app row still written vs nothing written at
  // all). Sharing the arrange would need a helper parameterised by which channel
  // is off plus the expected outcome, which is just both tests restated through
  // indirection. Revisit if a third delivery channel joins the gate.
  // fallow-ignore-next-line code-duplication
  it('does not backfill mail to a user who turned the email channel off', async () => {
    // The sweep enqueues; the insert-notification use case is what runs next.
    // Feeding it the sweep's own job data proves the backfill goes through the
    // preference gate rather than around it.
    const { handler, fakes } = makeHarness([item(1, 30 * MINUTE)])
    await handler(job)
    const enqueued = fakes.jobs[0]!.data as InsertNotificationInput

    const insertDeps = buildFakeInsertNotificationDeps()
    vi.mocked(insertDeps.preferenceRepo.findForDelivery).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        channel === 'email' ? preference(false) : null,
    )

    await expect(insertNotification(insertDeps)(enqueued)).resolves.not.toBeNull()
    expect(insertDeps.notificationRepo.insert).toHaveBeenCalledTimes(1)
    // No email-queue row: the disabled channel is respected on the backfill.
    expect(insertDeps.emailRepo.insert).not.toHaveBeenCalled()
  })

  it('produces nothing at all for a user who disabled both channels', async () => {
    const { handler, fakes } = makeHarness([item(1, 30 * MINUTE)])
    await handler(job)
    const enqueued = fakes.jobs[0]!.data as InsertNotificationInput

    const insertDeps = buildFakeInsertNotificationDeps()
    vi.mocked(insertDeps.preferenceRepo.findForDelivery).mockResolvedValue(
      preference(false),
    )

    await expect(insertNotification(insertDeps)(enqueued)).resolves.toBeNull()
    expect(insertDeps.notificationRepo.insert).not.toHaveBeenCalled()
    expect(insertDeps.emailRepo.insert).not.toHaveBeenCalled()
  })
})
