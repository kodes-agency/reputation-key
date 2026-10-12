import { describe, expect, it } from 'vitest'
import {
  describeResponsibilities,
  offersSupportingPortals,
} from './portal-responsibilities-rules'

describe('describeResponsibilities', () => {
  const text = describeResponsibilities('Avery Morgan')

  it('says the primary portal credits its ratings to the person', () => {
    expect(text).toContain('primary portal are credited to Avery Morgan')
  })

  it('says supporting portals credit nothing', () => {
    expect(text).toContain('Supporting portals')
    expect(text).toContain('their ratings are not credited to Avery Morgan')
  })

  it('keeps the reminder that this is not access', () => {
    expect(text).toContain('does not give access to the property')
  })
})

describe('offersSupportingPortals', () => {
  it('has nothing to offer with one portal, or none', () => {
    expect(offersSupportingPortals(0)).toBe(false)
    expect(offersSupportingPortals(1)).toBe(false)
  })

  it('offers supporting portals once there is another besides the primary', () => {
    expect(offersSupportingPortals(2)).toBe(true)
    expect(offersSupportingPortals(5)).toBe(true)
  })
})
