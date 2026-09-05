import { describe, expect, it } from 'vitest'
import {
  classifyProviderRejection,
  classifyNotification,
  deliveryTiming,
  isDailyDigestWindow,
  requiredCapabilityForPreferenceChannel,
  GOVERNING_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SETTINGS_CATEGORIES,
} from './notification-delivery-policy'
import { NOTIFICATION_TYPES } from './types'
import { getDefaultEnabled } from './notification-policy'

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
    expect(classifyNotification('account.organization_access_granted')).toBe('mandatory')
    expect(classifyNotification('account.organization_role_changed')).toBe('mandatory')
    expect(classifyNotification('account.organization_access_removed')).toBe('mandatory')
    expect(classifyNotification('reply.publish_failed')).toBe('urgent_operational')
    expect(classifyNotification('feedback.created')).toBe('urgent_operational')
    expect(classifyNotification('review.created')).toBe('workflow_collaboration')
    expect(classifyNotification('review.updated')).toBe('urgent_operational')
    expect(classifyNotification('inbox.reopened')).toBe('urgent_operational')
  })

  // ── Category surfaces ─────────────────────────────────────────────

  it('keeps retained Recognition data out of active beta controls', () => {
    expect(NOTIFICATION_CATEGORIES).toContain('recognition')
    expect(NOTIFICATION_SETTINGS_CATEGORIES).toEqual([
      'urgent_operational',
      'workflow_collaboration',
    ])
    expect(GOVERNING_NOTIFICATION_CATEGORIES).toEqual([
      'mandatory',
      'urgent_operational',
      'workflow_collaboration',
    ])
  })

  it('advertises every active settings category that governs a type', () => {
    // Two-way invariant, deliberately NOT a hardcoded array: a hardcoded
    // expectation would sleep through exactly the regression that produced a
    // settings switch governing nothing.
    const governedByAType = new Set(NOTIFICATION_TYPES.map(classifyNotification))

    for (const category of GOVERNING_NOTIFICATION_CATEGORIES) {
      expect(
        governedByAType.has(category),
        `${category} is advertised as governing but no notification type maps to it`,
      ).toBe(true)
    }
    for (const category of NOTIFICATION_SETTINGS_CATEGORIES) {
      if (!governedByAType.has(category)) continue
      expect(
        GOVERNING_NOTIFICATION_CATEGORIES.includes(category),
        `${category} is active and governs a type but is missing from GOVERNING_NOTIFICATION_CATEGORIES`,
      ).toBe(true)
    }
  })

  it('keeps Organization policy out of Property preference controls', () => {
    expect(GOVERNING_NOTIFICATION_CATEGORIES).toContain('mandatory')
    expect(NOTIFICATION_SETTINGS_CATEGORIES).not.toContain('mandatory')
  })

  it('leaves every notification type in-app-enabled by default', () => {
    // The `goal.completed` bug: its category defaulted to
    // {in_app:false, email:false}, so the use case persisted nothing at all.
    // A type may be email-opt-in, but a type nobody can see anywhere is a
    // dropped notification. Add an opt-in type here only with a reason.
    const DELIBERATELY_IN_APP_OPT_IN: ReadonlyArray<string> = []

    for (const type of NOTIFICATION_TYPES) {
      if (DELIBERATELY_IN_APP_OPT_IN.includes(type)) continue
      expect(
        getDefaultEnabled(classifyNotification(type), 'in_app'),
        `${type} classifies as ${classifyNotification(type)}, which is in-app OFF by default — it would be persisted nowhere`,
      ).toBe(true)
    }
  })

  it('classifies a completed goal as recognition, not a digest', () => {
    expect(classifyNotification('goal.completed')).toBe('recognition')
    expect(classifyNotification('goal.result_revised')).toBe('recognition')
  })
})
