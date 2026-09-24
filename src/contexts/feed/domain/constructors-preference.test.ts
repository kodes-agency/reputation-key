import { describe, expect, it } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import {
  createNotificationCategoryDefault,
  createPersonalDeliveryWindow,
} from './constructors-preference'

const NOW = new Date('2026-09-23T10:00:00.000Z')
const ORG = organizationId('org-1')
const USER = userId('user-1')

describe('createPersonalDeliveryWindow', () => {
  it('accepts a window that spans midnight with the urgent bypass on', () => {
    const result = createPersonalDeliveryWindow({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.quietHoursEnd).toBe('07:00')
  })

  it('accepts no quiet hours at all', () => {
    const result = createPersonalDeliveryWindow({
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
    })

    expect(result.isOk()).toBe(true)
  })

  it.each([
    {
      caseName: 'a start with no end',
      input: { quietHoursStart: '22:00', quietHoursEnd: null },
      message: 'Quiet hours require a valid start and end',
    },
    {
      caseName: 'an hour that does not exist',
      input: { quietHoursStart: '24:00', quietHoursEnd: '07:00' },
      message: 'Quiet hours require a valid start and end',
    },
    {
      caseName: 'a time without its leading zero',
      input: { quietHoursStart: '22:00', quietHoursEnd: '7:00' },
      message: 'Quiet hours require a valid start and end',
    },
    {
      // `deliveryTiming` reads equal times as no quiet hours at all, so saving
      // 22:00-22:00 in the belief that email is held back sends every email.
      caseName: 'a window that starts and ends at the same time',
      input: { quietHoursStart: '22:00', quietHoursEnd: '22:00' },
      message: 'Quiet hours must start and end at different times',
    },
  ])('refuses $caseName', ({ input, message }) => {
    const result = createPersonalDeliveryWindow({
      ...input,
      urgentBypassEnabled: false,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'invalid_input', message })
    }
  })
})

describe('createNotificationCategoryDefault', () => {
  const base = {
    userId: USER,
    organizationId: ORG,
    category: 'workflow_collaboration' as const,
    channel: 'email' as const,
    enabled: true,
    cadence: 'daily' as const,
  }

  it('stamps the default with the clock', () => {
    const result = createNotificationCategoryDefault(base, () => NOW)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.updatedAt).toEqual(NOW)
  })

  it('refuses a default for mandatory notices, which are not configurable', () => {
    const result = createNotificationCategoryDefault(
      { ...base, category: 'mandatory' as unknown as typeof base.category },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_input',
        message: 'Mandatory notifications cannot be configured',
      })
    }
  })

  it('refuses to turn off a channel the category requires', () => {
    const result = createNotificationCategoryDefault(
      {
        ...base,
        category: 'urgent_operational',
        channel: 'in_app',
        enabled: false,
        cadence: 'immediate',
      },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        message: 'This notification channel is required and cannot be disabled',
      })
    }
  })

  it('refuses an immediate goal-email default, which would be one mail per result', () => {
    const result = createNotificationCategoryDefault(
      { ...base, category: 'recognition', cadence: 'immediate' },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({ message: 'Goal email is sent once a day' })
    }
  })
})
