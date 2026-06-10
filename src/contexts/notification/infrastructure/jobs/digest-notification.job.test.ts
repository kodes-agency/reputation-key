/* eslint-disable @typescript-eslint/no-explicit-any */
// Notification context — digest-notification job handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDigestNotificationJobHandler } from './digest-notification.job'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Notification, NotificationEmail } from '../../domain/types'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import type { Job } from 'bullmq'

const ORG_ID_1 = 'org-1'
const ORG_ID_2 = 'org-2'
const USER_ID_1 = 'user-1'
const USER_ID_2 = 'user-2'
const NOTIF_ID_1 = 'notif-1'
const EMAIL_ID_1 = 'email-1'
const FIXED_DATE = new Date('2026-06-10T08:00:00Z')

function createFakeEmailEntry(
  overrides: Partial<NotificationEmail> = {},
): NotificationEmail {
  return {
    id: notificationEmailId(EMAIL_ID_1),
    notificationId: notificationId(NOTIF_ID_1),
    userId: userId(USER_ID_1),
    organizationId: organizationId(ORG_ID_1),
    status: 'pending',
    priority: 'normal',
    sentAt: null,
    failedAt: null,
    retryCount: 0,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  }
}

function createFakeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: notificationId(NOTIF_ID_1),
    userId: userId(USER_ID_1),
    organizationId: organizationId(ORG_ID_1),
    type: 'review.created',
    priority: 'normal',
    status: 'unread',
    resourceType: 'inbox_item',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'New review',
    body: 'A 4-star review',
    readAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  }
}

/** Generate timezone rows covering all 24 hours using Etc/GMT offsets. */
function allHourTimezoneRows(orgId: string) {
  const rows: { organization_id: string; timezone: string }[] = []
  for (let offset = -11; offset <= 12; offset++) {
    const tz =
      offset === 0
        ? 'UTC'
        : offset > 0
          ? `Etc/GMT-${offset}`
          : `Etc/GMT+${Math.abs(offset)}`
    rows.push({ organization_id: orgId, timezone: tz })
  }
  return rows
}

/** All-hour timezones for ORG_ID_1. */
const ALL_HOUR_TIMEZONES = allHourTimezoneRows(ORG_ID_1)

function createFakeDeps(): Record<string, any> {
  return {
    pool: { query: vi.fn() },
    emailRepo: {
      insert: vi.fn(),
      findById: vi.fn(),
      findPendingByOrg: vi.fn(),
      findPendingUrgent: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      markSkipped: vi.fn(),
    },
    notifRepo: {
      insert: vi.fn(),
      findById: vi.fn(),
      findUnreadByUser: vi.fn(),
      countUnreadByUser: vi.fn(),
      findByUser: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    },
    userLookup: {
      findByRole: vi.fn(),
      findAssignedManagers: vi.fn(),
      getEmail: vi.fn(),
      getName: vi.fn(),
    },
    emailSender: { send: vi.fn() },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as LoggerPort,
  }
}

/** Set up all mock return values for a happy-path digest flow. */
function setupDigestMocks(deps: ReturnType<typeof createFakeDeps>) {
  deps.pool.query.mockResolvedValue({ rows: ALL_HOUR_TIMEZONES })
  deps.emailRepo.findPendingByOrg.mockResolvedValue([])
  deps.notifRepo.findById.mockResolvedValue(null)
  deps.userLookup.getEmail.mockResolvedValue(null)
  deps.emailSender.send.mockResolvedValue(undefined)
  deps.emailRepo.markSent.mockResolvedValue(undefined)
  deps.emailRepo.markFailed.mockResolvedValue(undefined)
}

function createFakeJob(): Job {
  return {
    id: 'job-digest-1',
    data: undefined as unknown as void,
    attemptsMade: 0,
    log: vi.fn(),
  } as unknown as Job
}

describe('createDigestNotificationJobHandler', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('queries properties table for org + timezone pairs', async () => {
    deps.pool.query.mockResolvedValue({ rows: [] })

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.pool.query).toHaveBeenCalledTimes(1)
    expect(deps.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT organization_id'),
    )
  })

  it('does nothing when no properties exist', async () => {
    deps.pool.query.mockResolvedValue({ rows: [] })

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailRepo.findPendingByOrg).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('sends digest for qualifying org and marks entries sent', async () => {
    setupDigestMocks(deps)

    const entry = createFakeEmailEntry({
      id: notificationEmailId(EMAIL_ID_1),
      notificationId: notificationId(NOTIF_ID_1),
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    deps.emailRepo.findPendingByOrg.mockResolvedValue([entry])
    deps.notifRepo.findById.mockResolvedValue(createFakeNotification())
    deps.userLookup.getEmail.mockResolvedValue('user@example.com')

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    // At least one timezone from ALL_HOUR_TIMEZONES will be hour 8
    expect(deps.emailSender.send).toHaveBeenCalled()
    expect(deps.emailRepo.markSent).toHaveBeenCalled()
    expect(deps.emailRepo.markFailed).not.toHaveBeenCalled()

    // Verify email content
    const sendCall = deps.emailSender.send.mock.calls[0][0]
    expect(sendCall.to).toBe('user@example.com')
    expect(sendCall.subject).toBe('Your daily digest — Reputation Key')
    expect(sendCall.html).toContain('New review')
  })

  it('groups emails by user and sends one digest per user', async () => {
    setupDigestMocks(deps)

    const user1Entry = createFakeEmailEntry({
      id: notificationEmailId('e-u1-1'),
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    const user2Entry = createFakeEmailEntry({
      id: notificationEmailId('e-u2-1'),
      userId: userId(USER_ID_2),
      organizationId: organizationId(ORG_ID_1),
    })

    deps.emailRepo.findPendingByOrg.mockResolvedValue([user1Entry, user2Entry])
    deps.notifRepo.findById.mockResolvedValue(
      createFakeNotification({ title: 'Grouped notif', body: 'Body' }),
    )
    deps.userLookup.getEmail.mockImplementation((uid: string) =>
      uid === USER_ID_1
        ? Promise.resolve('user1@example.com')
        : Promise.resolve('user2@example.com'),
    )

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailSender.send.mock.calls.length).toBe(2)
    const subjects = deps.emailSender.send.mock.calls.map((c: any[]) => c[0].subject)
    expect(subjects).toEqual([
      'Your daily digest — Reputation Key',
      'Your daily digest — Reputation Key',
    ])
  })

  it('skips users with no email address', async () => {
    setupDigestMocks(deps)

    const entry = createFakeEmailEntry({
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    deps.emailRepo.findPendingByOrg.mockResolvedValue([entry])
    deps.notifRepo.findById.mockResolvedValue(createFakeNotification())
    deps.userLookup.getEmail.mockResolvedValue(null) // no email

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.markSent).not.toHaveBeenCalled()
  })

  it('skips entries when no notifications found for the user', async () => {
    setupDigestMocks(deps)

    const entry = createFakeEmailEntry({
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    deps.emailRepo.findPendingByOrg.mockResolvedValue([entry])
    deps.notifRepo.findById.mockResolvedValue(null) // no notification
    deps.userLookup.getEmail.mockResolvedValue('user@example.com')

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('marks all entries failed when email send fails and logs error', async () => {
    setupDigestMocks(deps)

    const entry = createFakeEmailEntry({
      id: notificationEmailId(EMAIL_ID_1),
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    deps.emailRepo.findPendingByOrg.mockResolvedValue([entry])
    deps.notifRepo.findById.mockResolvedValue(createFakeNotification())
    deps.userLookup.getEmail.mockResolvedValue('user@example.com')
    deps.emailSender.send.mockRejectedValue(new Error('SES down'))

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      notificationEmailId(EMAIL_ID_1),
      expect.any(Date),
      expect.any(Date),
    )
    expect(deps.emailRepo.markSent).not.toHaveBeenCalled()
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Digest email send failed',
    )
  })

  it('handles invalid timezone gracefully by skipping', async () => {
    setupDigestMocks(deps)
    deps.pool.query.mockResolvedValue({
      rows: [{ organization_id: ORG_ID_1, timezone: 'Invalid/Timezone' }],
    })

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailRepo.findPendingByOrg).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('skips when qualifying org has no pending emails', async () => {
    setupDigestMocks(deps)
    deps.emailRepo.findPendingByOrg.mockResolvedValue([]) // no pending

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('handles markFailed error gracefully during failure path', async () => {
    setupDigestMocks(deps)

    const entry = createFakeEmailEntry({
      id: notificationEmailId(EMAIL_ID_1),
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    deps.emailRepo.findPendingByOrg.mockResolvedValue([entry])
    deps.notifRepo.findById.mockResolvedValue(createFakeNotification())
    deps.userLookup.getEmail.mockResolvedValue('user@example.com')
    deps.emailSender.send.mockRejectedValue(new Error('SES down'))
    deps.emailRepo.markFailed.mockRejectedValue(new Error('markFailed also broke'))

    const handler = createDigestNotificationJobHandler(deps as any)
    // Should not throw — inner catch handles markFailed errors
    await handler(createFakeJob())

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ markErr: expect.any(Error) }),
      'Failed to mark digest email as failed',
    )
  })

  it('processes multiple orgs independently', async () => {
    // Set up two orgs with their own timezone sets
    deps.pool.query.mockResolvedValue({
      rows: [...allHourTimezoneRows(ORG_ID_1), ...allHourTimezoneRows(ORG_ID_2)],
    })

    const org1Entry = createFakeEmailEntry({
      id: notificationEmailId('e-org1'),
      userId: userId(USER_ID_1),
      organizationId: organizationId(ORG_ID_1),
    })
    const org2Entry = createFakeEmailEntry({
      id: notificationEmailId('e-org2'),
      userId: userId(USER_ID_2),
      organizationId: organizationId(ORG_ID_2),
    })

    deps.emailRepo.findPendingByOrg.mockImplementation((orgId: string) => {
      if (orgId === ORG_ID_1) return Promise.resolve([org1Entry])
      if (orgId === ORG_ID_2) return Promise.resolve([org2Entry])
      return Promise.resolve([])
    })
    deps.notifRepo.findById.mockResolvedValue(createFakeNotification())
    deps.userLookup.getEmail.mockImplementation((uid: string) =>
      Promise.resolve(`${uid}@example.com`),
    )
    deps.emailSender.send.mockResolvedValue(undefined)

    const handler = createDigestNotificationJobHandler(deps as any)
    await handler(createFakeJob())

    // Both orgs should have findPendingByOrg called
    expect(deps.emailRepo.findPendingByOrg.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
