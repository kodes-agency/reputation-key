// Response-SLA extraction tests — default fallback + coercion rules.

import { describe, it, expect } from 'vitest'
import { DEFAULT_RESPONSE_SLA_HOURS, extractResponseSlaHours } from './response-sla'

describe('extractResponseSlaHours', () => {
  it('returns the org value when it is a positive finite number', () => {
    expect(extractResponseSlaHours({ responseSlaHours: 24 })).toBe(24)
  })

  it('rounds fractional hours', () => {
    expect(extractResponseSlaHours({ responseSlaHours: 23.6 })).toBe(24)
  })

  it('falls back to the default when the field is missing', () => {
    expect(extractResponseSlaHours({})).toBe(DEFAULT_RESPONSE_SLA_HOURS)
  })

  it('falls back to the default for null/undefined input', () => {
    expect(extractResponseSlaHours(null)).toBe(DEFAULT_RESPONSE_SLA_HOURS)
    expect(extractResponseSlaHours(undefined)).toBe(DEFAULT_RESPONSE_SLA_HOURS)
  })

  it('falls back when the value is not a number', () => {
    expect(extractResponseSlaHours({ responseSlaHours: '48' })).toBe(
      DEFAULT_RESPONSE_SLA_HOURS,
    )
  })

  it('falls back when the value is non-finite', () => {
    expect(extractResponseSlaHours({ responseSlaHours: Number.POSITIVE_INFINITY })).toBe(
      DEFAULT_RESPONSE_SLA_HOURS,
    )
    expect(extractResponseSlaHours({ responseSlaHours: Number.NaN })).toBe(
      DEFAULT_RESPONSE_SLA_HOURS,
    )
  })

  it('falls back when the value is zero or negative', () => {
    expect(extractResponseSlaHours({ responseSlaHours: 0 })).toBe(
      DEFAULT_RESPONSE_SLA_HOURS,
    )
    expect(extractResponseSlaHours({ responseSlaHours: -5 })).toBe(
      DEFAULT_RESPONSE_SLA_HOURS,
    )
  })

  it('exports a 48h default', () => {
    expect(DEFAULT_RESPONSE_SLA_HOURS).toBe(48)
  })
})
