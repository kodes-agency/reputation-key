import { describe, expect, it } from 'vitest'
import {
  classifyProviderRejection,
  classifyNotification,
  deliveryTiming,
  isDailyDigestWindow,
  rejectionProvesNonAcceptance,
  requiredCapabilityForPreferenceChannel,
  GOVERNING_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SETTINGS_CATEGORIES,
} from './notification-delivery-policy'
import { NOTIFICATION_TYPES } from './notification-types'
import { getDefaultEnabled } from './notification-policy'

/** Instants in 2026 at which `timezone` changes its UTC offset, to the hour. */
function dstTransitions2026(timezone: string): Date[] {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  })
  const offsetAt = (instant: number): number => {
    const parts = format.formatToParts(instant)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((entry) => entry.type === type)?.value)
    const wallClock = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    )
    return wallClock - Math.floor(instant / 60_000) * 60_000
  }
  const HOUR = 60 * 60_000
  const transitions: Date[] = []
  for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2027, 0, 1); day += 24 * HOUR) {
    if (offsetAt(day) === offsetAt(day + 24 * HOUR)) continue
    let instant = day + HOUR
    while (offsetAt(instant) === offsetAt(day)) instant += HOUR
    transitions.push(new Date(instant))
  }
  return transitions
}

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

  it('defers to a one-hour evening window on the spring-forward day instead of throwing', () => {
    // Quiet 00:30–23:30 leaves 60 minutes to deliver in. The old jump added
    // the remaining WALL-CLOCK minutes as real time, overshot the window by
    // the hour the clocks lose, and threw a RangeError out of the job.
    const result = deliveryTiming({
      now: new Date('2026-03-08T05:30:00.000Z'),
      timezone: 'America/New_York',
      quietHoursStart: '00:30',
      quietHoursEnd: '23:30',
      urgent: false,
      urgentBypassEnabled: false,
    })

    expect(result).toEqual({
      kind: 'defer',
      until: new Date('2026-03-09T03:30:00.000Z'),
    })
  })

  it('defers to a one-hour morning window across the night the clocks spring forward', () => {
    const result = deliveryTiming({
      now: new Date('2026-03-07T14:00:00.000Z'),
      timezone: 'America/New_York',
      quietHoursStart: '09:00',
      quietHoursEnd: '08:00',
      urgent: false,
      urgentBypassEnabled: false,
    })

    expect(result).toEqual({
      kind: 'defer',
      until: new Date('2026-03-08T12:00:00.000Z'),
    })
  })

  it('waits for the next day when the only delivery hour vanishes in the DST gap', () => {
    // 02:00–03:00 does not exist in New York on 8 March 2026, so the next
    // minute outside quiet hours is 02:00 on the 9th — two days away.
    const result = deliveryTiming({
      now: new Date('2026-03-07T08:00:00.000Z'),
      timezone: 'America/New_York',
      quietHoursStart: '03:00',
      quietHoursEnd: '02:00',
      urgent: false,
      urgentBypassEnabled: false,
    })

    expect(result).toEqual({
      kind: 'defer',
      until: new Date('2026-03-09T06:00:00.000Z'),
    })
  })

  it('never throws and never defers into quiet time around any 2026 DST transition', () => {
    // Zones chosen for their shifts: 60 min, 30 min (Lord Howe), 2 h (Troll)
    // and a 45-minute offset (Chatham).
    const zones = [
      'America/New_York',
      'Australia/Lord_Howe',
      'Antarctica/Troll',
      'Pacific/Chatham',
    ]
    const windows = [
      ['00:30', '23:30'],
      ['09:00', '08:00'],
      ['22:00', '07:00'],
      ['03:00', '02:00'],
    ] as const
    const HOUR = 60 * 60_000
    for (const timezone of zones) {
      const minuteOf = (instant: Date) => {
        const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        })
          .format(instant)
          .split(':')
          .map(Number)
        return hour! * 60 + minute!
      }
      const transitions = dstTransitions2026(timezone)
      expect(transitions, timezone).toHaveLength(2)
      for (const transition of transitions) {
        for (const [quietHoursStart, quietHoursEnd] of windows) {
          const [start, end] = [quietHoursStart, quietHoursEnd].map((value) => {
            const [hour, minute] = value.split(':').map(Number)
            return hour! * 60 + minute!
          })
          const quiet = (minute: number) =>
            start! < end!
              ? minute >= start! && minute < end!
              : minute >= start! || minute < end!
          for (let offset = -30; offset <= 6; offset += 1) {
            const now = new Date(transition.getTime() + offset * HOUR)
            const result = deliveryTiming({
              now,
              timezone,
              quietHoursStart,
              quietHoursEnd,
              urgent: false,
              urgentBypassEnabled: false,
            })
            if (result.kind === 'send') continue
            const label = `${timezone} ${quietHoursStart}-${quietHoursEnd} at ${now.toISOString()}`
            expect(result.until.getTime(), label).toBeGreaterThan(now.getTime())
            expect(result.until.getTime() - now.getTime(), label).toBeLessThan(50 * HOUR)
            expect(quiet(minuteOf(result.until)), label).toBe(false)
          }
        }
      }
    }
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

  it('retries a request the provider never answered instead of abandoning it', () => {
    // The Resend SDK does not throw on a DNS failure, a refused or reset
    // connection, or a response lost mid-body: it returns this exact error with
    // statusCode null. The idempotency key makes the retry safe either way.
    expect(
      classifyProviderRejection({
        statusCode: null,
        providerCode: 'application_error',
        message: 'Unable to fetch data. The request could not be resolved.',
      }),
    ).toBe('transient')
  })

  it('retries a timeout and a concurrent use of the same idempotency key', () => {
    expect(
      classifyProviderRejection({
        statusCode: 408,
        providerCode: null,
        message: 'Request Timeout',
      }),
    ).toBe('transient')
    expect(
      classifyProviderRejection({
        statusCode: 409,
        providerCode: 'concurrent_idempotent_requests',
        message: 'Another request with the same idempotency key is in progress.',
      }),
    ).toBe('transient')
  })

  it('treats only an answer given before acceptance as proof the message was not accepted', () => {
    // A rate or quota limit or a validation failure is answered before the
    // provider takes the message. No answer, a timeout, a 5xx or a conflict
    // on the idempotency key may all follow a message it accepted.
    expect([429, 422, 400].map(rejectionProvesNonAcceptance)).toEqual([true, true, true])
    expect([null, 408, 409, 500, 503].map(rejectionProvesNonAcceptance)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('keeps a reused idempotency key with a different payload terminal', () => {
    expect(
      classifyProviderRejection({
        statusCode: 409,
        providerCode: 'invalid_idempotent_request',
        message: 'The request body does not match the original request.',
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

  it('offers goal results (recognition) as a Property control and a filter', () => {
    expect(NOTIFICATION_CATEGORIES).toContain('recognition')
    expect(NOTIFICATION_SETTINGS_CATEGORIES).toEqual([
      'urgent_operational',
      'workflow_collaboration',
      'recognition',
    ])
    expect(GOVERNING_NOTIFICATION_CATEGORIES).toEqual([
      'mandatory',
      'urgent_operational',
      'workflow_collaboration',
      'recognition',
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
