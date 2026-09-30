import { describe, expect, it } from 'vitest'
import {
  NO_QUIET_HOURS,
  resolveCategoryPreference,
  resolveDeliveryWindow,
} from './notification-preference-resolution'

const window = (
  start: string | null,
  end: string | null,
  urgentBypassEnabled = false,
) => ({ quietHoursStart: start, quietHoursEnd: end, urgentBypassEnabled })

describe('resolveDeliveryWindow', () => {
  it("uses the person's quiet hours for a property that overrides nothing", () => {
    expect(resolveDeliveryWindow(window('22:00', '07:00'), null)).toEqual(
      window('22:00', '07:00'),
    )
  })

  it("replaces the person's window whole where a property overrides it", () => {
    expect(
      resolveDeliveryWindow(window('22:00', '07:00', true), window('00:00', '06:00')),
    ).toEqual(window('00:00', '06:00', false))
  })

  it('lets a property override mean no quiet hours at all', () => {
    expect(resolveDeliveryWindow(window('22:00', '07:00'), window(null, null))).toEqual(
      NO_QUIET_HOURS,
    )
  })

  it('holds nothing back when neither the person nor the property set any', () => {
    expect(resolveDeliveryWindow(null, null)).toEqual(NO_QUIET_HOURS)
  })
})

describe('resolveCategoryPreference', () => {
  const resolve = (
    property: Readonly<{ enabled: boolean; cadence: 'immediate' | 'daily' }> | null,
    personalDefault: Readonly<{
      enabled: boolean
      cadence: 'immediate' | 'daily'
    }> | null,
  ) =>
    resolveCategoryPreference({
      category: 'workflow_collaboration',
      channel: 'email',
      property,
      personalDefault,
    })

  it("prefers the property's own row over the person's default", () => {
    expect(
      resolve(
        { enabled: true, cadence: 'immediate' },
        { enabled: false, cadence: 'daily' },
      ),
    ).toEqual({ enabled: true, cadence: 'immediate' })
  })

  it("gives a property with no row of its own the person's default", () => {
    expect(resolve(null, { enabled: true, cadence: 'immediate' })).toEqual({
      enabled: true,
      cadence: 'immediate',
    })
  })

  it('falls back to the versioned defaults when the person set neither', () => {
    expect(resolve(null, null)).toEqual({ enabled: false, cadence: 'daily' })
  })

  it('keeps a mandatory-like required channel enabled through the defaults', () => {
    expect(
      resolveCategoryPreference({
        category: 'urgent_operational',
        channel: 'in_app',
        property: null,
        personalDefault: null,
      }),
    ).toEqual({ enabled: true, cadence: 'immediate' })
  })

  it('delivers a goal default saved as immediate in the daily digest', () => {
    expect(
      resolveCategoryPreference({
        category: 'recognition',
        channel: 'email',
        property: null,
        personalDefault: { enabled: true, cadence: 'immediate' },
      }),
    ).toEqual({ enabled: true, cadence: 'daily' })
  })
})

// ADR 0046, amended 2026-09-30: how low is part of the answer, and falls back
// like the rest of it.
describe('resolveCategoryPreference for Low ratings', () => {
  const resolveLow = (
    channel: 'in_app' | 'email',
    property: Readonly<{
      enabled: boolean
      cadence: 'immediate'
      maxRating: 1 | 2 | 3 | 4
    }> | null,
    personalDefault: Readonly<{
      enabled: boolean
      cadence: 'immediate'
      maxRating: 1 | 2 | 3 | 4
    }> | null = null,
  ) =>
    resolveCategoryPreference({
      category: 'low_ratings',
      channel,
      property,
      personalDefault,
    })

  it('is on, and immediate, at 3 stars or lower in the app and 2 by email when nobody chose', () => {
    expect(resolveLow('in_app', null)).toEqual({
      enabled: true,
      cadence: 'immediate',
      maxRating: 3,
    })
    expect(resolveLow('email', null)).toEqual({
      enabled: true,
      cadence: 'immediate',
      maxRating: 2,
    })
  })

  it("takes the Property's own threshold over the person's default", () => {
    expect(
      resolveLow(
        'email',
        { enabled: true, cadence: 'immediate', maxRating: 4 },
        { enabled: true, cadence: 'immediate', maxRating: 1 },
      ),
    ).toMatchObject({ maxRating: 4 })
    expect(
      resolveLow('email', null, { enabled: true, cadence: 'immediate', maxRating: 1 }),
    ).toMatchObject({ maxRating: 1 })
  })

  it('gives every other category no threshold at all', () => {
    expect(
      resolveCategoryPreference({
        category: 'arrivals',
        channel: 'email',
        property: null,
        personalDefault: null,
      }),
    ).not.toHaveProperty('maxRating')
  })
})
