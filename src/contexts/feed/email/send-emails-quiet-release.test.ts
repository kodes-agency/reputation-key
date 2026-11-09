// An immediate email held by quiet hours is released when the window ends,
// not at the next top-of-hour sweep. Nothing used to schedule it: the row was
// marked delayed and only the hourly digest run re-enqueued it, up to 59
// minutes late (30 minutes every day for a half-hour timezone), and the
// acceptance-lag alert deliberately ignores quiet-hours holds.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSendEmailsHandler } from './send-emails.server'
import {
  entry,
  fakeDeps,
  job,
  ORG,
  PROPERTY,
} from '../infrastructure/jobs/send-emails-test-deps'

// 15:00Z is 17:00 in Sofia; the window 16:00–07:30 ends at 05:30Z tomorrow.
const QUIET_UNTIL = new Date('2026-01-16T05:30:00.000Z')

describe('an immediate email held by quiet hours', () => {
  let deps: ReturnType<typeof fakeDeps> & {
    scheduleRelease: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    deps = { ...fakeDeps(), scheduleRelease: vi.fn(async () => {}) }
    deps.preferenceRepo.getUserSettings.mockResolvedValue({
      timezone: 'Europe/Sofia',
    } as never)
    deps.preferenceRepo.resolveDeliveryWindow.mockResolvedValue({
      quietHoursStart: '16:00',
      quietHoursEnd: '07:30',
      urgentBypassEnabled: false,
    } as never)
  })

  const run = () =>
    createSendEmailsHandler(
      deps as unknown as Parameters<typeof createSendEmailsHandler>[0],
    )(job)

  it('schedules its own release for the minute the window ends', async () => {
    await run()

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.scheduleRelease).toHaveBeenCalledWith(
      {
        notificationEmailId: entry.id,
        organizationId: ORG,
        propertyId: PROPERTY,
      },
      QUIET_UNTIL,
    )
  })

  it('still holds the row when the release cannot be scheduled', async () => {
    deps.scheduleRelease.mockRejectedValue(new Error('Redis unavailable'))

    await expect(run()).resolves.toBeUndefined()

    expect(deps.emailRepo.markDelayed).toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ until: QUIET_UNTIL.toISOString() }),
      'Quiet-hours release not scheduled; the hourly sweep will release the email',
    )
  })

  it('holds a retry whose window starts before it runs, and sends nothing', async () => {
    deps.emailRepo.findById.mockResolvedValue({
      ...entry,
      status: 'failed' as const,
      retryCount: 1,
      attemptedAt: new Date('2026-01-15T13:50:00.000Z'),
      providerRequest: {
        to: 'manager@example.com',
        subject: 'Frozen subject',
        html: '<p>frozen</p>',
        text: 'frozen',
        headers: {},
        replyTo: null,
      },
    })

    await run()

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.markDelayed).toHaveBeenCalled()
    expect(deps.scheduleRelease).toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: entry.id }),
      QUIET_UNTIL,
    )
  })
})
