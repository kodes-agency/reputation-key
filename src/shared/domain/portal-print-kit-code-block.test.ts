import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from './guest-locale'
import { PRINT_KIT_SCAN_CUE } from './portal-print-kit'
import {
  CAMERA_ICON,
  SCAN_CUE_WIDTH_EM,
  codeBlockColours,
  cueBlockHeightPt,
  cueLineHeightPt,
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
  type CueLine,
} from './portal-print-kit-code-block'
import { CODE_BLOCK, cueRoomPt, inToPt, ptToIn } from './portal-print-kit-measures'
import { printKitStylePalette } from './portal-print-kit-palette'

const cue = (text: string): CueLine => ({ text, locale: 'en' })

/** Every line is `pointsPerSize` wide for each point of its size: easy to aim at the room. */
const wideAs = (pointsPerSize: number) => (_line: CueLine, size: number) =>
  pointsPerSize * size

describe('cueLinesFor', () => {
  it('puts the lead language first, with its own cue', () => {
    expect(cueLinesFor(['es', 'en'])).toEqual([
      { text: 'Escanee con la cámara', locale: 'es' },
      { text: 'Scan with your camera', locale: 'en' },
    ])
  })

  it('has one line for one language and never more than two', () => {
    expect(cueLinesFor(['bg'])).toHaveLength(1)
    expect(cueLinesFor(['en', 'es', 'bg'])).toHaveLength(2)
  })
})

describe('codeBlockColours', () => {
  it('outlines the tile in the accent ink on Paper', () => {
    const palette = printKitStylePalette('#EAD6A8', null, 'paper')
    expect(codeBlockColours(palette)).toEqual({
      barFill: palette.barFill,
      barText: palette.barText,
      outline: '#765B1D',
    })
  })

  it('draws no outline on Immersive: cream on the field is already 16:1', () => {
    const palette = printKitStylePalette('#EAD6A8', null, 'immersive')
    expect(codeBlockColours(palette).outline).toBeNull()
  })
})

describe('planCodeBlock', () => {
  it('sets one line at 9.5 pt beside the pictogram, in a bar of 0.40 in', () => {
    const plan = planCodeBlock([cue('Scan')], wideAs(5))
    expect(plan).toMatchObject({ lines: 'one', cuePt: 9.5, iconAbove: false })
    expect(ptToIn(plan.barPt)).toBeCloseTo(0.4, 10)
    expect(ptToIn(plan.heightPt)).toBeCloseTo(2.4, 10)
    expect(ptToIn(plan.iconPt)).toBeCloseTo(0.17, 10)
  })

  it('sets two lines at 9 pt beside the pictogram, in a bar of 0.45 in', () => {
    const plan = planCodeBlock([cue('Scan'), cue('Escanee')], wideAs(5))
    expect(plan).toMatchObject({ lines: 'two', cuePt: 9, iconAbove: false })
    expect(ptToIn(plan.barPt)).toBeCloseTo(0.45, 10)
    expect(ptToIn(plan.heightPt)).toBeCloseTo(2.45, 10)
    expect(ptToIn(plan.iconPt)).toBeCloseTo(0.18, 10)
  })

  it('steps one line down to 9 pt before it gives the pictogram up its place', () => {
    // Too wide at 9.5 pt for the room beside the pictogram, narrow enough at 9 pt.
    const perSize = (cueRoomPt('one') - 0.1) / 9
    const plan = planCodeBlock([cue('Scan')], wideAs(perSize))
    expect(plan).toMatchObject({ cuePt: 9, iconAbove: false })
    expect(ptToIn(plan.barPt)).toBeCloseTo(0.4, 10)
  })

  it('moves the pictogram above the lines when a line does not fit at 9 pt, and the bar grows by 0.08 in', () => {
    const perSize = (cueRoomPt('two') + 0.1) / 9
    const plan = planCodeBlock([cue('Scan'), cue('Escanee')], wideAs(perSize))
    expect(plan).toMatchObject({ lines: 'two', cuePt: 9, iconAbove: true })
    expect(ptToIn(plan.barPt)).toBeCloseTo(0.45 + 0.08, 10)
    expect(plan.heightPt).toBeCloseTo(CODE_BLOCK.tilePt + plan.barPt, 10)
  })

  it('keeps a line that has the whole bar to itself at 9.5 pt when it fits there', () => {
    const fullRoom = CODE_BLOCK.tilePt - 2 * CODE_BLOCK.barPaddingPt
    const plan = planCodeBlock([cue('Scan')], wideAs((fullRoom - 1) / 9.5))
    expect(plan).toMatchObject({ cuePt: 9.5, iconAbove: true })
    expect(ptToIn(plan.barPt)).toBeCloseTo(0.48, 10)
  })

  it('never sets a cue under 9 pt, whatever the width', () => {
    const plan = planCodeBlock([cue('Scan'), cue('Escanee')], wideAs(1000))
    expect(plan.cuePt).toBe(9)
    expect(plan.iconAbove).toBe(true)
  })

  it('keeps the bar exactly as wide as the tile, which is 2 in', () => {
    expect(inToPt(2)).toBe(CODE_BLOCK.tilePt)
  })
})

describe('the cue block', () => {
  it('is as tall as its lines and the gap between them', () => {
    const plan = planCodeBlock([cue('a'), cue('b')], wideAs(1))
    expect(cueLineHeightPt(plan)).toBeCloseTo(9 * 1.12, 10)
    expect(cueBlockHeightPt(plan, 1)).toBeCloseTo(9 * 1.12, 10)
    expect(cueBlockHeightPt(plan, 2)).toBeCloseTo(2 * 9 * 1.12 + CODE_BLOCK.cueGapPt, 10)
  })
})

describe('estimatedCueWidthPt', () => {
  it('knows the width of every guest language’s cue', () => {
    for (const locale of GUEST_LOCALES) {
      expect(SCAN_CUE_WIDTH_EM[locale], locale).toBeGreaterThan(8)
      const width = estimatedCueWidthPt({ text: PRINT_KIT_SCAN_CUE[locale], locale }, 9)
      expect(width, locale).toBeGreaterThan(70)
      expect(width, locale).toBeLessThan(120)
    }
  })

  it('takes the French line to be the longest', () => {
    const widths = GUEST_LOCALES.map(
      (locale) =>
        [
          locale,
          estimatedCueWidthPt({ text: PRINT_KIT_SCAN_CUE[locale], locale }, 9),
        ] as const,
    )
    const longest = widths.reduce((a, b) => (b[1] > a[1] ? b : a))
    expect(longest[0]).toBe('fr')
  })

  it('takes another text for a wide average, so it errs toward moving the pictogram', () => {
    const custom = estimatedCueWidthPt(
      { text: 'Scan with your camera now', locale: 'en' },
      9,
    )
    const standard = estimatedCueWidthPt({ text: PRINT_KIT_SCAN_CUE.en, locale: 'en' }, 9)
    expect(custom).toBeGreaterThan(standard)
  })
})

describe('the pictogram', () => {
  it('is a stroke camera, a body and a lens, on a 24-unit grid with a 1.7 stroke', () => {
    expect(CAMERA_ICON.grid).toBe(24)
    expect(CAMERA_ICON.strokeWidth).toBe(1.7)
    expect(CAMERA_ICON.body.startsWith('M3.5 8.5')).toBe(true)
    expect(CAMERA_ICON.lens).toEqual({ cx: 12, cy: 12.8, r: 3.6 })
  })
})
