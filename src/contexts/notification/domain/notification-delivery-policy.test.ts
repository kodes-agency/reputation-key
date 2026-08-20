import { describe, expect, it } from 'vitest'
import {
  classifyProviderRejection,
  classifyNotification,
  deliveryTiming,
  isDailyDigestWindow,
  requiredCapabilityForPreferenceChannel,
  shouldSuppressDelivery,
} from './notification-delivery-policy'

describe('notification delivery policy', () => {
  it('defers a non-urgent immediate email until quiet hours end across the DST spring gap', () => {
    const result = deliveryTiming({
      now: new Date('2026-03-08T06:30:00.000Z'),
      timezone: 'America/New_York',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgent: false,
      urgentBypassEnabled: false,
    })

    expect(result).toEqual({
      kind: 'defer',
      until: new Date('2026-03-08T11:00:00.000Z'),
    })
  })

  it('defers through the repeated DST fall hour without sending early', () => {
    const result = deliveryTiming({
      now: new Date('2026-11-01T05:30:00.000Z'),
      timezone: 'America/New_York',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgent: false,
      urgentBypassEnabled: false,
    })

    expect(result).toEqual({
      kind: 'defer',
      until: new Date('2026-11-01T12:00:00.000Z'),
    })
  })

  it('allows urgent quiet-hours bypass only after explicit opt-in', () => {
    const base = {
      now: new Date('2026-01-15T05:00:00.000Z'),
      timezone: 'America/New_York',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgent: true,
    } as const

    expect(deliveryTiming({ ...base, urgentBypassEnabled: false }).kind).toBe('defer')
    expect(deliveryTiming({ ...base, urgentBypassEnabled: true })).toEqual({
      kind: 'send',
    })
  })

  it('runs a daily digest only during 08:00 in the concrete property timezone', () => {
    expect(
      isDailyDigestWindow(new Date('2026-03-08T12:00:00.000Z'), 'America/New_York'),
    ).toBe(true)
    expect(
      isDailyDigestWindow(new Date('2026-03-08T12:00:00.000Z'), 'America/Los_Angeles'),
    ).toBe(false)
  })

  it('classifies provider retry, terminal, and suppression outcomes', () => {
    expect(
      classifyProviderRejection({
        statusCode: 429,
        providerCode: 'rate_limit_exceeded',
        message: 'retry later',
      }),
    ).toBe('transient')
    expect(
      classifyProviderRejection({
        statusCode: 422,
        providerCode: 'recipient_suppressed',
        message: 'suppressed',
      }),
    ).toBe('suppressed')
    expect(
      classifyProviderRejection({
        statusCode: 400,
        providerCode: 'validation_error',
        message: 'invalid payload',
      }),
    ).toBe('permanent')
  })

  it('requires the outbound-email capability only for email preference mutations', () => {
    expect(requiredCapabilityForPreferenceChannel('email')).toBe(
      'notification.send_email',
    )
    expect(requiredCapabilityForPreferenceChannel('in_app')).toBeUndefined()
  })
  it('maps notification types to governed categories', () => {
    expect(classifyNotification('reply.publish_failed')).toBe('urgent_operational')
    expect(classifyNotification('badge.awarded')).toBe('recognition')
    expect(classifyNotification('review.created')).toBe('workflow_collaboration')
  })

  it('suppresses bounced, complained, and explicit suppression states', () => {
    expect(shouldSuppressDelivery('bounced')).toBe(true)
    expect(shouldSuppressDelivery('complained')).toBe(true)
    expect(shouldSuppressDelivery('suppressed')).toBe(true)
    expect(shouldSuppressDelivery('failed')).toBe(false)
  })
})
