// Notification context — insert-notification job handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInsertNotificationHandler } from './insert-notification.job'
import type { InsertNotificationDeps } from '../../application/use-cases/insert-notification'
import type { Notification } from '../../domain/types'
import { buildFakeInsertNotificationDeps as createFakeDeps } from '../../application/use-cases/test-fixtures'
import { organizationId, userId } from '#/shared/domain/ids'
import type { Job } from 'bullmq'

// ── Mock trace & logger so the job doesn't need ALS / pino ──────────
vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}))

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const FIXED_DATE = new Date('2026-06-10T10:00:00Z')

function createFakeJob(data: unknown): Job {
  return {
    id: 'job-1',
    data,
    attemptsMade: 0,
    log: vi.fn(),
  } as unknown as Job
}

describe('createInsertNotificationHandler', () => {
  let deps: InsertNotificationDeps

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('delegates to insertNotification use case with job.data', async () => {
    const handler = createInsertNotificationHandler(deps)
    const job = createFakeJob({
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'review.created',
      resourceType: 'inbox_item',
      resourceId: 'res-1',
      eventId: 'evt-1',
      title: 'New review',
      body: '4-star review received',
    })

    await handler(job)

    expect(deps.notificationRepo.insert).toHaveBeenCalledTimes(1)
    const inserted = (deps.notificationRepo.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Notification
    expect(inserted.type).toBe('review.created')
    expect(inserted.title).toBe('New review')
    expect(inserted.userId).toBe(USER_ID)
    expect(inserted.organizationId).toBe(ORG_ID)
  })

  it('enqueues email when default preferences apply', async () => {
    const handler = createInsertNotificationHandler(deps)
    const job = createFakeJob({
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'review.created',
      resourceType: 'inbox_item',
      resourceId: 'res-1',
      eventId: 'evt-1',
      title: 'Test',
      body: null,
    })

    await handler(job)

    expect(deps.emailRepo.insert).toHaveBeenCalledTimes(1)
  })

  it('re-throws use case errors for BullMQ retry', async () => {
    ;(deps.notificationRepo.insert as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DB connection lost'),
    )

    const handler = createInsertNotificationHandler(deps)
    const job = createFakeJob({
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'review.created',
      resourceType: 'inbox_item',
      resourceId: 'res-1',
      eventId: 'evt-1',
      title: 'Test',
      body: 'body',
    })

    await expect(handler(job)).rejects.toThrow('DB connection lost')
  })

  it('throws on invalid notification type', async () => {
    const handler = createInsertNotificationHandler(deps)
    const job = createFakeJob({
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'bogus.type',
      resourceType: 'inbox_item',
      resourceId: 'res-1',
      eventId: 'evt-1',
      title: 'Test',
      body: 'body',
    })

    await expect(handler(job)).rejects.toThrow('Invalid notification type: bogus.type')
  })

  it('does not persist notification when both channels disabled by preference', async () => {
    ;(
      deps.preferenceRepo.findByUserAndType as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'pref-1',
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'review.created',
      emailEnabled: false,
      inAppEnabled: false,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    })

    const handler = createInsertNotificationHandler(deps)
    const job = createFakeJob({
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'review.created',
      resourceType: 'inbox_item',
      resourceId: 'res-1',
      eventId: 'evt-1',
      title: 'Test',
      body: 'body',
    })

    await handler(job)

    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
  })

  it('handles urgent type correctly', async () => {
    const handler = createInsertNotificationHandler(deps)
    const job = createFakeJob({
      userId: USER_ID,
      organizationId: ORG_ID,
      type: 'inbox.escalated',
      resourceType: 'inbox_item',
      resourceId: 'res-1',
      eventId: 'evt-1',
      title: 'Escalated',
      body: null,
    })

    await handler(job)

    const inserted = (deps.notificationRepo.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Notification
    expect(inserted.priority).toBe('urgent')
  })
})
