// An immediate email held by quiet hours is released when the window ends,
// not at the next top-of-hour sweep. Nothing used to schedule it: the row was
// marked delayed and only the hourly digest run re-enqueued it, up to 59
// minutes late (30 minutes every day for a half-hour timezone), and the
// acceptance-lag alert deliberately ignores quiet-hours holds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedUserSettings } from './delivery-seed'
import {
  ADDRESS,
  ORG,
  PROPERTY,
  USER,
  openSendWorld,
  type SendWorld,
} from './send-emails-test-deps'

// 15:00Z is 17:00 in Sofia; the window 16:00–07:30 ends at 05:30Z tomorrow.
const QUIET_UNTIL = new Date('2026-01-16T05:30:00.000Z')

let world: SendWorld

const open = async (options: Parameters<typeof openSendWorld>[0] = {}) => {
  world = await openSendWorld(options)
  await seedUserSettings(world.db, {
    userId: USER,
    organizationId: ORG,
    timezone: 'Europe/Sofia',
    quietHoursStart: '16:00',
    quietHoursEnd: '07:30',
  })
  const deps = {
    ...world.deps(),
    scheduleRelease: vi.fn(async (..._args: unknown[]) => {}),
  }
  return deps
}

afterEach(async () => {
  await world.rollBack()
})

describe('an immediate email held by quiet hours', () => {
  let deps: Awaited<ReturnType<typeof open>>

  beforeEach(async () => {
    deps = await open()
  })

  it('schedules its own release for the minute the window ends', async () => {
    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject({
      status: 'delayed',
      notBefore: QUIET_UNTIL,
    })
    expect(deps.scheduleRelease).toHaveBeenCalledWith(
      {
        notificationEmailId: world.notice.emailId,
        organizationId: ORG,
        propertyId: PROPERTY,
      },
      QUIET_UNTIL,
    )
  })

  it('still holds the row when the release cannot be scheduled', async () => {
    deps.scheduleRelease.mockRejectedValue(new Error('Redis unavailable'))

    await expect(world.run(deps)).resolves.toBeUndefined()

    expect(await world.email()).toMatchObject({ status: 'delayed' })
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ until: QUIET_UNTIL.toISOString() }),
      'Quiet-hours release not scheduled; the hourly sweep will release the email',
    )
  })

  it('holds a retry whose window starts before it runs, and sends nothing', async () => {
    await world.rollBack()
    deps = await open({
      notice: {
        email: {
          status: 'failed',
          retryCount: 1,
          attemptedAt: new Date('2026-01-15T13:50:00.000Z'),
          providerRequest: {
            to: ADDRESS,
            subject: 'Frozen subject',
            html: '<p>frozen</p>',
            text: 'frozen',
            headers: {},
            replyTo: null,
          },
        },
      },
    })
    await world.setEmail({ lastErrorClass: 'transient' })

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject({
      status: 'delayed',
      notBefore: QUIET_UNTIL,
    })
    expect(deps.scheduleRelease).toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: world.notice.emailId }),
      QUIET_UNTIL,
    )
  })
})
