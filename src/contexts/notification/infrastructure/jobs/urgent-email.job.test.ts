// Notification context — urgent-email job handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createUrgentEmailJobHandler } from './urgent-email.job'
import type { Notification, NotificationEmail } from '../../domain/types'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import type { Job } from 'bullmq'
import {
  createFakeEmailRepo,
  createFakeNotifRepo,
  createFakeUserLookup,
  createFakeEmailSender,
  createFakeJobLogger,
  createFakeClock,
} from './test-fixtures'
import type {
  FakeEmailRepo,
  FakeNotifRepo,
  FakeUserLookup,
  FakeEmailSender,
  FakeJobLogger,
  FakeClock,
} from './test-fixtures'

const EMAIL_ENTRY_ID = notificationEmailId('email-entry-1')
const NOTIF_ID = notificationId('notif-1')
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const FIXED_DATE = new Date('2026-06-10T10:00:00Z')

function createFakeEmailEntry(
  overrides: Partial<NotificationEmail> = {},
): NotificationEmail {
  return {
    id: EMAIL_ENTRY_ID,
    notificationId: NOTIF_ID,
    userId: USER_ID,
    organizationId: ORG_ID,
    status: 'pending',
    priority: 'urgent',
    sentAt: null,
    failedAt: null,
    retryCount: 0,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  }
}

function createFakeNotification(): Notification {
  return {
    id: NOTIF_ID,
    userId: USER_ID,
    organizationId: ORG_ID,
    type: 'inbox.escalated',
    priority: 'urgent',
    status: 'unread',
    resourceType: 'inbox_item',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'Review escalated',
    body: 'A review was escalated',
    readAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  }
}

export type FakeUrgentDeps = {
  emailRepo: FakeEmailRepo
  notifRepo: FakeNotifRepo
  userLookup: FakeUserLookup
  emailSender: FakeEmailSender
  logger: FakeJobLogger
  clock: FakeClock
}

function createFakeDeps(): FakeUrgentDeps {
  return {
    emailRepo: createFakeEmailRepo(),
    notifRepo: createFakeNotifRepo(),
    userLookup: createFakeUserLookup(),
    emailSender: createFakeEmailSender(),
    logger: createFakeJobLogger(),
    clock: createFakeClock(FIXED_DATE),
  }
}

/** Set up all mocks for a happy-path flow where the email is sent successfully. */
function setupHappyPathMocks(
  deps: FakeUrgentDeps,
  overrides: { entry?: NotificationEmail; notif?: Notification } = {},
) {
  deps.emailRepo.findById.mockResolvedValue(overrides.entry ?? createFakeEmailEntry())
  deps.notifRepo.findById.mockResolvedValue(overrides.notif ?? createFakeNotification())
  deps.userLookup.getEmail.mockResolvedValue('user@example.com')
  deps.emailSender.send.mockResolvedValue(undefined)
  deps.emailRepo.markSent.mockResolvedValue(undefined)
  deps.emailRepo.markFailed.mockResolvedValue(undefined)
  deps.emailRepo.markSkipped.mockResolvedValue(undefined)
}

function createFakeJob(emailId: string, orgIdOverride?: string): Job {
  return {
    id: 'job-urgent-1',
    data: { notificationEmailId: emailId, organizationId: orgIdOverride ?? 'org-1' },
    attemptsMade: 0,
    log: vi.fn(),
  } as unknown as Job
}

/**
 * Create + run the urgent-email handler for the standard test entry. Centralises
 * the fake→port cast so individual tests read as plain actions.
 */
function runUrgentHandler(deps: FakeUrgentDeps) {
  return createUrgentEmailJobHandler(
    deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
  )(createFakeJob('email-entry-1'))
}

/** Assert the email sender was never called. */
function expectNoEmailSent(deps: FakeUrgentDeps): void {
  expect(deps.emailSender.send).not.toHaveBeenCalled()
}

describe('createUrgentEmailJobHandler', () => {
  let deps: FakeUrgentDeps

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('sends email for a pending entry and marks it sent', async () => {
    setupHappyPathMocks(deps, { entry: createFakeEmailEntry({ status: 'pending' }) })

    await runUrgentHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const sendCall = deps.emailSender.send.mock.calls[0][0]
    expect(sendCall.to).toBe('user@example.com')
    expect(sendCall.subject).toContain('Review escalated')
    expect(sendCall.html).toContain('Review escalated')

    expect(deps.emailRepo.markSent).toHaveBeenCalledWith(
      EMAIL_ENTRY_ID,
      'org-1',
      expect.any(Date),
      expect.any(Date),
    )
    expect(deps.emailRepo.markFailed).not.toHaveBeenCalled()
  })

  it('sends email for a failed entry (retry)', async () => {
    setupHappyPathMocks(deps, { entry: createFakeEmailEntry({ status: 'failed' }) })

    await runUrgentHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.emailRepo.markSent).toHaveBeenCalledWith(
      EMAIL_ENTRY_ID,
      'org-1',
      expect.any(Date),
      expect.any(Date),
    )
  })

  it('skips if entry not found', async () => {
    setupHappyPathMocks(deps)
    deps.emailRepo.findById.mockResolvedValue(null)

    await runUrgentHandler(deps)

    expectNoEmailSent(deps)
    expect(deps.emailRepo.markSent).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: EMAIL_ENTRY_ID }),
      'Urgent email entry not found or not retryable',
    )
  })

  it('skips if entry status is already "sent"', async () => {
    setupHappyPathMocks(deps)
    deps.emailRepo.findById.mockResolvedValue(createFakeEmailEntry({ status: 'sent' }))

    await runUrgentHandler(deps)

    expectNoEmailSent(deps)
  })

  it('skips if entry status is "skipped"', async () => {
    setupHappyPathMocks(deps)
    deps.emailRepo.findById.mockResolvedValue(createFakeEmailEntry({ status: 'skipped' }))

    await runUrgentHandler(deps)

    expectNoEmailSent(deps)
  })

  it.each([
    {
      label: 'notification not found',
      stub: (d: FakeUrgentDeps) => d.notifRepo.findById.mockResolvedValue(null),
    },
    {
      label: 'user email not found',
      stub: (d: FakeUrgentDeps) => d.userLookup.getEmail.mockResolvedValue(null),
    },
  ])('marks skipped when $label', async ({ stub }) => {
    setupHappyPathMocks(deps)
    stub(deps)

    await runUrgentHandler(deps)

    expectNoEmailSent(deps)
    expect(deps.emailRepo.markSkipped).toHaveBeenCalledWith(
      EMAIL_ENTRY_ID,
      'org-1',
      expect.any(Date),
    )
  })

  it('marks failed and re-throws when email send fails', async () => {
    setupHappyPathMocks(deps)
    deps.emailSender.send.mockRejectedValue(new Error('SMTP down'))

    await expect(runUrgentHandler(deps)).rejects.toThrow('SMTP down')

    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      EMAIL_ENTRY_ID,
      'org-1',
      expect.any(Date),
      expect.any(Date),
    )
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: EMAIL_ENTRY_ID }),
      'Urgent email send failed',
    )
    expect(deps.emailRepo.markSent).not.toHaveBeenCalled()
  })

  it('includes notification title and body in email html', async () => {
    setupHappyPathMocks(deps, {
      notif: {
        ...createFakeNotification(),
        title: 'Important update',
        body: 'Please review this item',
      },
    })

    await runUrgentHandler(deps)

    const html = deps.emailSender.send.mock.calls[0][0].html
    expect(html).toContain('Important update')
    expect(html).toContain('Please review this item')
  })

  it('sends email without body paragraph when notif body is null', async () => {
    setupHappyPathMocks(deps, {
      notif: { ...createFakeNotification(), body: null },
    })

    await runUrgentHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('escapes HTML in title and body', async () => {
    setupHappyPathMocks(deps, {
      notif: {
        ...createFakeNotification(),
        title: '<script>alert("xss")</script>',
        body: '<b>bold</b>',
      },
    })

    await runUrgentHandler(deps)

    const html = deps.emailSender.send.mock.calls[0][0].html
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
  })

  it('uses injected clock for transition timestamps, not new Date()', async () => {
    const clockDate = new Date('2026-07-04T12:00:00Z')
    deps.clock = vi.fn(() => clockDate)
    setupHappyPathMocks(deps, { entry: createFakeEmailEntry({ status: 'pending' }) })

    await runUrgentHandler(deps)

    // markSent must receive the clock's timestamp, proving the job uses
    // deps.clock() rather than constructing `new Date()` inline.
    expect(deps.clock).toHaveBeenCalled()
    expect(deps.emailRepo.markSent).toHaveBeenCalledWith(
      EMAIL_ENTRY_ID,
      'org-1',
      clockDate,
      clockDate,
    )
  })
})
