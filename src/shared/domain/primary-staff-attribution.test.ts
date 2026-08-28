import { describe, expect, it } from 'vitest'
import {
  primaryStaffAttributionContains,
  primaryStaffAttributionEquals,
  type PrimaryStaffAttributionSnapshot,
} from './primary-staff-attribution'

const START = new Date('2026-08-01T00:00:00.000Z')
const END = new Date('2026-09-01T00:00:00.000Z')

function attribution(
  overrides: Partial<PrimaryStaffAttributionSnapshot> = {},
): PrimaryStaffAttributionSnapshot {
  return {
    staffParticipantId: 'staff-participant-1',
    staffParticipationId: 'staff-participation-1',
    portalResponsibilityId: 'portal-responsibility-1',
    effectiveFrom: START,
    effectiveTo: END,
    ...overrides,
  }
}

describe('Primary Staff attribution equality', () => {
  it('treats both missing snapshots as equal and one missing snapshot as different', () => {
    expect(primaryStaffAttributionEquals(null, undefined)).toBe(true)
    expect(primaryStaffAttributionEquals(null, attribution())).toBe(false)
    expect(primaryStaffAttributionEquals(attribution(), undefined)).toBe(false)
  })

  it('compares the complete identifier and effective-interval snapshot', () => {
    expect(primaryStaffAttributionEquals(attribution(), attribution())).toBe(true)
    expect(
      primaryStaffAttributionEquals(
        attribution(),
        attribution({ staffParticipantId: 'staff-participant-2' }),
      ),
    ).toBe(false)
    expect(
      primaryStaffAttributionEquals(
        attribution(),
        attribution({ staffParticipationId: 'staff-participation-2' }),
      ),
    ).toBe(false)
    expect(
      primaryStaffAttributionEquals(
        attribution(),
        attribution({ portalResponsibilityId: 'portal-responsibility-2' }),
      ),
    ).toBe(false)
    expect(
      primaryStaffAttributionEquals(
        attribution(),
        attribution({ effectiveFrom: new Date('2026-08-02T00:00:00.000Z') }),
      ),
    ).toBe(false)
    expect(
      primaryStaffAttributionEquals(
        attribution(),
        attribution({ effectiveTo: new Date('2026-09-02T00:00:00.000Z') }),
      ),
    ).toBe(false)
  })

  it('compares open-ended intervals without inventing an end instant', () => {
    expect(
      primaryStaffAttributionEquals(
        attribution({ effectiveTo: null }),
        attribution({ effectiveTo: null }),
      ),
    ).toBe(true)
    expect(
      primaryStaffAttributionEquals(attribution({ effectiveTo: null }), attribution()),
    ).toBe(false)
  })
})

describe('Primary Staff attribution event-time containment', () => {
  it('uses a start-inclusive and end-exclusive effective interval', () => {
    const closed = attribution()

    expect(primaryStaffAttributionContains(closed, START)).toBe(true)
    expect(
      primaryStaffAttributionContains(closed, new Date('2026-08-31T23:59:59.999Z')),
    ).toBe(true)
    expect(primaryStaffAttributionContains(closed, END)).toBe(false)
    expect(
      primaryStaffAttributionContains(closed, new Date('2026-07-31T23:59:59.999Z')),
    ).toBe(false)
  })

  it('keeps an open-ended attribution effective after its start', () => {
    const openEnded = attribution({ effectiveTo: null })

    expect(
      primaryStaffAttributionContains(openEnded, new Date('2036-08-01T00:00:00.000Z')),
    ).toBe(true)
  })

  it('fails closed for invalid observation or interval instants', () => {
    expect(primaryStaffAttributionContains(attribution(), new Date('invalid'))).toBe(
      false,
    )
    expect(
      primaryStaffAttributionContains(
        attribution({ effectiveFrom: new Date('invalid') }),
        START,
      ),
    ).toBe(false)
    expect(
      primaryStaffAttributionContains(
        attribution({ effectiveTo: new Date('invalid') }),
        START,
      ),
    ).toBe(false)
  })
})
