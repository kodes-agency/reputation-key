import { describe, expect, it } from 'vitest'
import {
  isResolvableTimezone,
  localDateKey,
  localDateLabel,
  recipientTimezoneSource,
  resolveRecipientTimezone,
} from './recipient-timezone'

describe('recipient timezone resolution (ADR 0046 r.3)', () => {
  it('prefers the user timezone over the organization and property timezones', () => {
    const sources = {
      userTimezone: 'Europe/Sofia',
      organizationTimezone: 'Europe/London',
      propertyTimezone: 'America/Denver',
    }

    expect(resolveRecipientTimezone(sources)).toBe('Europe/Sofia')
    expect(recipientTimezoneSource(sources)).toBe('user')
  })

  it('falls back to the organization timezone when the user never chose one', () => {
    const sources = {
      userTimezone: null,
      organizationTimezone: 'Europe/London',
      propertyTimezone: 'America/Denver',
    }

    expect(resolveRecipientTimezone(sources)).toBe('Europe/London')
    expect(recipientTimezoneSource(sources)).toBe('organization')
  })

  it('falls through an unresolvable stored timezone instead of throwing', () => {
    // A garbage row must not abort the sweep for every other recipient.
    const sources = {
      userTimezone: 'Mars/Olympus_Mons',
      organizationTimezone: 'Europe/London',
    }

    expect(resolveRecipientTimezone(sources)).toBe('Europe/London')
    expect(recipientTimezoneSource(sources)).toBe('organization')
  })

  it('ends at UTC when nothing is resolvable', () => {
    const sources = { userTimezone: '', organizationTimezone: null }

    expect(resolveRecipientTimezone(sources)).toBe('UTC')
    expect(recipientTimezoneSource(sources)).toBe('default')
  })

  it('accepts IANA link names that supportedValuesOf omits', () => {
    expect(isResolvableTimezone('Asia/Calcutta')).toBe(true)
    expect(isResolvableTimezone('Not/AZone')).toBe(false)
    expect(isResolvableTimezone(undefined)).toBe(false)
  })
})

describe('local date keys', () => {
  it('keys the digest on the recipient local date, not the UTC date', () => {
    // 23:30 in Denver on the 20th is already the 21st in UTC.
    const now = new Date('2026-08-21T05:30:00Z')

    expect(localDateKey(now, 'America/Denver')).toBe('2026-08-20')
    expect(localDateKey(now, 'UTC')).toBe('2026-08-21')
  })

  it('produces a human date label for the subject line', () => {
    expect(localDateLabel(new Date('2026-08-21T09:00:00Z'), 'UTC')).toBe(
      'Friday 21 August',
    )
  })
})
