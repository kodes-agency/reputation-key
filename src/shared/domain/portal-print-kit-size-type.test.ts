// The type and the logo per size against the round-3 spec-delta (S3: the type
// table, the logo's optical sizes; S4: the fit steps of a two-language Table card).

import { describe, expect, it } from 'vitest'
import { PRINT_KIT_STYLES } from './portal-print-kit'
import { BAND, FACE_ELEMENTS, FACE_KINDS, type FaceKind } from './portal-print-kit-sizes'
import {
  FACE_TYPE_PT,
  LOGO_OPTICAL,
  MINI_READ_FLOOR_PT,
  TABLE_TWO_LANGUAGE_FIT,
  logoOpticalHeightMm,
} from './portal-print-kit-size-type'
import { TYPE_FLOOR_PT, ptToIn } from './portal-print-kit-measures'

/** The reading size a face never goes under: 9 pt, and 8 pt on Mini. */
const readFloor = (kind: FaceKind) =>
  kind === 'mini' ? MINI_READ_FLOOR_PT : TYPE_FLOOR_PT.read

describe('the type per size (spec-delta S3)', () => {
  it('sets the name at 8.5 and 7.5 pt, and drops it on the tent and Mini', () => {
    expect(FACE_TYPE_PT.large.name).toBe(8.5)
    expect(FACE_TYPE_PT.table.name).toBe(7.5)
    expect(FACE_TYPE_PT.tent.name).toBeNull()
    expect(FACE_TYPE_PT.mini.name).toBeNull()
  })

  it('sets the eyebrow at 10, 9 and 9 pt, and drops it on Mini', () => {
    expect(FACE_TYPE_PT.large.eyebrow).toBe(10)
    expect(FACE_TYPE_PT.table.eyebrow).toBe(9)
    expect(FACE_TYPE_PT.tent.eyebrow).toBe(9)
    expect(FACE_TYPE_PT.mini.eyebrow).toBeNull()
  })

  it('sets the call to action at 28 / 30, 24 / 26, 17 / 18 and 20 / 26 pt, Immersive / Paper', () => {
    expect([FACE_TYPE_PT.large.ctaImmersive, FACE_TYPE_PT.large.ctaPaper]).toEqual([
      28, 30,
    ])
    expect([FACE_TYPE_PT.table.ctaImmersive, FACE_TYPE_PT.table.ctaPaper]).toEqual([
      24, 26,
    ])
    expect([FACE_TYPE_PT.mini.ctaImmersive, FACE_TYPE_PT.mini.ctaPaper]).toEqual([17, 18])
    expect([FACE_TYPE_PT.tent.ctaImmersive, FACE_TYPE_PT.tent.ctaPaper]).toEqual([20, 26])
  })

  it('sets the sub-line at 11, 9.5, 9.5 and 8 pt', () => {
    expect(FACE_TYPE_PT.large.sub).toBe(11)
    expect(FACE_TYPE_PT.table.sub).toBe(9.5)
    expect(FACE_TYPE_PT.tent.sub).toBe(9.5)
    expect(FACE_TYPE_PT.mini.sub).toBe(8)
  })

  it('sets the second call to action at 15 and 13 pt, where there is one', () => {
    expect(FACE_TYPE_PT.large.cta2).toBe(15)
    expect(FACE_TYPE_PT.table.cta2).toBe(13)
    expect(FACE_TYPE_PT.tent.cta2).toBeNull()
    expect(FACE_TYPE_PT.mini.cta2).toBeNull()
  })

  it('sets the wordmark at 16, 14, 13 and 11 pt', () => {
    expect(FACE_TYPE_PT.large.wordmark).toBe(16)
    expect(FACE_TYPE_PT.table.wordmark).toBe(14)
    expect(FACE_TYPE_PT.tent.wordmark).toBe(13)
    expect(FACE_TYPE_PT.mini.wordmark).toBe(11)
  })

  it.each(FACE_KINDS)('sets the call to action largest on %s, in both styles', (kind) => {
    const type = FACE_TYPE_PT[kind]
    const others = [type.name, type.eyebrow, type.sub, type.cta2, type.wordmark].filter(
      (size): size is number => size !== null,
    )
    for (const size of others) {
      expect(type.ctaImmersive).toBeGreaterThan(size)
      expect(type.ctaPaper).toBeGreaterThan(size)
    }
  })

  it.each(FACE_KINDS)(
    'sets Paper’s call to action at least as large as Immersive’s on %s',
    (kind) => {
      expect(FACE_TYPE_PT[kind].ctaPaper).toBeGreaterThanOrEqual(
        FACE_TYPE_PT[kind].ctaImmersive,
      )
    },
  )

  it.each(FACE_KINDS)(
    'sets nothing a guest reads under its size’s floor on %s (9 pt, 8 pt on Mini)',
    (kind) => {
      // The name line is the one caption: it repeats the logo, and spec R2 sets it at 8.5 pt.
      const type = FACE_TYPE_PT[kind]
      const read = [
        type.eyebrow,
        type.ctaImmersive,
        type.ctaPaper,
        type.sub,
        type.cta2,
      ].filter((size): size is number => size !== null)
      for (const size of read) expect(size).toBeGreaterThanOrEqual(readFloor(kind))
    },
  )

  it('lets only Mini read under 9 pt, at 8, because its tile and bar are 1.25 in', () => {
    expect(MINI_READ_FLOOR_PT).toBe(8)
    expect(MINI_READ_FLOOR_PT).toBeLessThan(TYPE_FLOOR_PT.read)
    expect(FACE_TYPE_PT.mini.sub).toBe(MINI_READ_FLOOR_PT)
  })

  it('shrinks every role the sizes share as the size gets smaller', () => {
    const ladder = ['large', 'table', 'mini'] as const
    for (let step = 1; step < ladder.length; step += 1) {
      const bigger = FACE_TYPE_PT[ladder[step - 1] as FaceKind]
      const smaller = FACE_TYPE_PT[ladder[step] as FaceKind]
      expect(smaller.ctaImmersive).toBeLessThan(bigger.ctaImmersive)
      expect(smaller.ctaPaper).toBeLessThan(bigger.ctaPaper)
      expect(smaller.sub).toBeLessThan(bigger.sub)
      expect(smaller.wordmark).toBeLessThan(bigger.wordmark)
    }
  })

  it.each(FACE_KINDS)('sets a size for an element only where %s keeps it', (kind) => {
    const type = FACE_TYPE_PT[kind]
    const elements = FACE_ELEMENTS[kind]
    expect(type.name !== null).toBe(elements.name)
    expect(type.eyebrow !== null).toBe(elements.eyebrow)
    expect(type.cta2 !== null).toBe(elements.secondLanguage === 'headline')
  })
})

describe('the logo’s optical sizes (spec-delta S3)', () => {
  const sizes = (kind: FaceKind, style: 'immersive' | 'paper') => {
    const optical = LOGO_OPTICAL[kind][style]
    return [optical.opticalMm, optical.heightMinMm, optical.heightMaxMm]
  }

  it('sets Immersive at 15, 12.5, 10 and 12 mm (heights 9.5–13, 8–10.5, 6.5–8.5, 8–10)', () => {
    expect(sizes('large', 'immersive')).toEqual([15, 9.5, 13])
    expect(sizes('table', 'immersive')).toEqual([12.5, 8, 10.5])
    expect(sizes('mini', 'immersive')).toEqual([10, 6.5, 8.5])
    expect(sizes('tent', 'immersive')).toEqual([12, 8, 10])
  })

  it('sets Paper at 17, 14.5, 11 and 14 mm (heights 10.5–14, 9–12, 7–9, 9–12)', () => {
    expect(sizes('large', 'paper')).toEqual([17, 10.5, 14])
    expect(sizes('table', 'paper')).toEqual([14.5, 9, 12])
    expect(sizes('mini', 'paper')).toEqual([11, 7, 9])
    expect(sizes('tent', 'paper')).toEqual([14, 9, 12])
  })

  it.each(FACE_KINDS)(
    'gives Paper a larger logo than Immersive on %s, which has a plate round it',
    (kind) => {
      expect(LOGO_OPTICAL[kind].paper.opticalMm).toBeGreaterThan(
        LOGO_OPTICAL[kind].immersive.opticalMm,
      )
    },
  )

  it('has a floor under its height that is under its ceiling, in every case', () => {
    for (const kind of FACE_KINDS) {
      for (const style of PRINT_KIT_STYLES) {
        const optical = LOGO_OPTICAL[kind][style]
        expect(optical.heightMinMm).toBeLessThan(optical.heightMaxMm)
        expect(optical.opticalMm).toBeGreaterThan(optical.heightMinMm)
      }
    }
  })

  describe('logoOpticalHeightMm', () => {
    const tableImmersive = LOGO_OPTICAL.table.immersive
    const largeImmersive = LOGO_OPTICAL.large.immersive

    it('holds the geometric mean of the drawn width and height at the optical size, so a square mark and a wide badge print alike', () => {
      for (const aspect of [1.5, 1.6, 2.2]) {
        const height = logoOpticalHeightMm(aspect, tableImmersive)
        expect(height * Math.sqrt(aspect)).toBeCloseTo(tableImmersive.opticalMm, 10)
      }
    })

    it('clamps the height to its ceiling for a square mark', () => {
      expect(logoOpticalHeightMm(1, largeImmersive)).toBe(largeImmersive.heightMaxMm)
    })

    it('clamps the height to its floor for a mark that is wide but not too wide to stay at the floor', () => {
      expect(logoOpticalHeightMm(3, largeImmersive)).toBe(largeImmersive.heightMinMm)
    })

    it('lets the width ceiling win over the height floor for a very wide mark', () => {
      const aspect = 5
      const height = logoOpticalHeightMm(aspect, largeImmersive)
      expect(height).toBeCloseTo(largeImmersive.widthMaxMm / aspect, 10)
      expect(height * aspect).toBeLessThanOrEqual(largeImmersive.widthMaxMm + 1e-9)
    })

    it('draws a logo of any shape inside the size’s box', () => {
      for (const kind of FACE_KINDS) {
        for (const style of PRINT_KIT_STYLES) {
          const optical = LOGO_OPTICAL[kind][style]
          for (const aspect of [0.8, 1, 1.6, 2.5, 4, 6]) {
            const height = logoOpticalHeightMm(aspect, optical)
            expect(height).toBeLessThanOrEqual(optical.heightMaxMm + 1e-9)
            expect(height * aspect).toBeLessThanOrEqual(optical.widthMaxMm + 1e-9)
          }
        }
      }
    })
  })
})

describe('the two-language Table card’s fit steps (spec-delta S4)', () => {
  it('takes the band, the call to action, the sub-line and the second call to action, in that order', () => {
    expect(TABLE_TWO_LANGUAGE_FIT.map((step) => step.step)).toEqual([
      'band',
      'cta',
      'sub',
      'cta2',
    ])
  })

  it('steps the band from 1.1 in to its 0.95 in minimum', () => {
    const [band] = TABLE_TWO_LANGUAGE_FIT
    expect(band?.from).toBe(BAND.table.targetPt)
    expect(band?.to).toBe(BAND.table.minPt)
    expect(ptToIn(band?.to ?? 0)).toBeCloseTo(0.95, 10)
  })

  it('steps the call to action 24 to 21 pt, the sub-line 9.5 to 9 pt and the second call to action 13 to 12 pt', () => {
    const [, cta, sub, cta2] = TABLE_TWO_LANGUAGE_FIT
    expect([cta?.from, cta?.to]).toEqual([FACE_TYPE_PT.table.ctaImmersive, 21])
    expect([sub?.from, sub?.to]).toEqual([FACE_TYPE_PT.table.sub, 9])
    expect([cta2?.from, cta2?.to]).toEqual([FACE_TYPE_PT.table.cta2, 12])
  })

  it('stops every type step at its floor and never makes anything larger', () => {
    const [, cta, sub, cta2] = TABLE_TWO_LANGUAGE_FIT
    expect(cta?.to).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.head)
    expect(sub?.to).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
    expect(cta2?.to).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.head2)
    for (const step of TABLE_TWO_LANGUAGE_FIT) {
      expect(step.to).toBeLessThan(step.from)
    }
  })
})
