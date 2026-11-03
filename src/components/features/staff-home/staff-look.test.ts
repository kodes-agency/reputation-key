import { describe, expect, it } from 'vitest'
import { contrastRatio } from '#/shared/domain/portal-field-colour'
import { staffHeaderIsDark, staffLogoPlate, staffLookVariables } from './staff-look'

const look = (accentColour: string, fieldColour = '') => ({
  displayName: 'Harbor Hotel',
  wordmark: null,
  accentColour,
  fieldColour,
  logo: null,
  hero: null,
})
const variables = (accent: string) =>
  staffLookVariables(look(accent)) as Readonly<Record<string, string>>

describe('the staff phone colours', () => {
  it.each(['#EAD6A8', '#1E4FC2', '#101010', '#FFFFFF', '#C8553D'])(
    'keeps every pairing readable for accent %s',
    (accent) => {
      const v = variables(accent)
      expect(
        contrastRatio(v['--staff-band']!, v['--staff-on-band']!),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(v['--staff-accent-dark']!, v['--staff-on-accent-dark']!),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(v['--staff-accent-dark']!, v['--staff-field']!),
      ).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(v['--staff-accent-light']!, '#FFFFFF')).toBeGreaterThanOrEqual(
        4.5,
      )
    },
  )
  it('falls back to the default look with nothing to read', () => {
    expect(staffLookVariables(undefined)).toEqual(staffLookVariables(look('')))
  })
})

describe('the plate under a logo', () => {
  it('backs a dark logo on a dark header and a pale logo on a light one', () => {
    expect(
      staffLogoPlate({ luminance: 0.02, onDark: true, accentColour: '#EAD6A8' }),
    ).not.toBeNull()
    expect(
      staffLogoPlate({ luminance: 0.95, onDark: false, accentColour: '#EAD6A8' }),
    ).not.toBeNull()
  })
  it('leaves a logo that already reads, or one it could not read, alone', () => {
    expect(
      staffLogoPlate({ luminance: 0.95, onDark: true, accentColour: '#EAD6A8' }),
    ).toBeNull()
    expect(
      staffLogoPlate({ luminance: null, onDark: true, accentColour: '#EAD6A8' }),
    ).toBeNull()
  })
})

describe('staffHeaderIsDark', () => {
  it('is dark on any photo, and on a band that takes white text', () => {
    expect(staffHeaderIsDark({ ...look('#E8D5A8'), hero: {} as never })).toBe(true)
    expect(staffHeaderIsDark(look('#1B2A49'))).toBe(true)
  })
  it('is light on a pale band, and on no colour at all, which reads as champagne', () => {
    expect(staffHeaderIsDark(look('#E8D5A8'))).toBe(false)
    expect(staffHeaderIsDark(look(''))).toBe(false)
  })
})
