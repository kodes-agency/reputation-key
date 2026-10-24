import { describe, expect, it } from 'vitest'
import { contrastRatio } from './portal-field-colour'
import {
  PRINT_FINAL_GROUND_INK_CAP,
  capGroundInk,
  printFinalImmersivePalette,
  printFinalKickerTint,
  printFinalTotalInk,
} from './portal-print-final-immersive'
import {
  printFinalKickerGround,
  printFinalSampledGround,
  type PrintFinalPhotoSample,
} from './portal-print-final-photo-sample'

// The Immersive colours against the boards' (final-design-2026-10-25,
// final-engine.mjs immPalette): the stand-in photos are not in the repository,
// so each is stood in for by its lower quarter's mean colour and the kicker
// ground the generator read from it.

/** A sample of one colour above `splitShare` of its height and another below. */
function sampleOf(
  top: readonly [number, number, number],
  bottom: readonly [number, number, number] = top,
  splitShare = 0.75,
): PrintFinalPhotoSample {
  const widthPx = 240
  const heightPx = 134
  const rgb = new Uint8ClampedArray(widthPx * heightPx * 3)
  for (let row = 0; row < heightPx; row++) {
    const colour = row < Math.floor(heightPx * splitShare) ? top : bottom
    for (let column = 0; column < widthPx; column++)
      rgb.set(colour, (row * widthPx + column) * 3)
  }
  return { widthPx, heightPx, rgb }
}

/** The stand-ins' lower quarters, decoded at 240 px wide as the generator decoded them. */
const STAND_INS = {
  oakmere: { mean: [132.25, 117.87, 101.062], field: '#001E57', ground: '#293143' },
  harborline: { mean: [78.118, 75.929, 69.59], field: '#001E57', ground: '#273246' },
  elegance: { mean: [203.683, 184.525, 177.637], field: '#2A1712', ground: '#402D26' },
} as const

describe('printFinalSampledGround', () => {
  it.each(Object.entries(STAND_INS))(
    '%s: keeps the hue of the lower quarter, darkened and mixed 60 % into the property colour',
    (_, standIn) => {
      const mean = standIn.mean
      const sample: PrintFinalPhotoSample = {
        widthPx: 1,
        heightPx: 4,
        rgb: [0, 0, 0, 0, 0, 0, 0, 0, 0, ...mean],
      }
      expect(printFinalSampledGround(sample, standIn.field)).toBe(standIn.ground)
    },
  )

  it('reads only the lower quarter', () => {
    const sky = sampleOf([250, 250, 255], [132, 118, 101])
    const ground = printFinalSampledGround(sky, '#001E57')
    expect(ground).toBe(printFinalSampledGround(sampleOf([132, 118, 101]), '#001E57'))
  })
})

describe('printFinalKickerGround', () => {
  it('is the 95th-percentile grey of the photo’s middle under the scrim', () => {
    expect(printFinalKickerGround(sampleOf([0, 0, 0]), 0.5)).toBe('#040404')
    const white = printFinalKickerGround(sampleOf([255, 255, 255]), 0.5)
    expect(white).toBe('#848484')
  })
})

describe('printFinalKickerTint', () => {
  it.each([
    ['Oakmere upright', '#D4E3FE', '#808080', '#FFFFFF'],
    ['Oakmere wide', '#D4E3FE', '#727272', '#F7FAFF'],
    ['Hotel Elegance upright', '#E3B873', '#686868', '#F5E5CC'],
    ['Hotel Elegance wide', '#E3B873', '#5C5C5C', '#EDD2A6'],
    ['Harborline', '#A8C6FE', '#545454', '#B2CDFE'],
  ])('%s: the board’s tint', (_, accent, against, tint) => {
    expect(printFinalKickerTint(accent, against)).toBe(tint)
  })

  it('reaches 4.5:1 or turns white', () => {
    for (const accent of ['#1D4FC4', '#D58400', '#FFFFFF', '#000000']) {
      const tint = printFinalKickerTint(accent, '#7A7A7A')
      expect(tint === '#FFFFFF' || (contrastRatio(tint, '#7A7A7A') ?? 0) >= 4.5).toBe(
        true,
      )
    }
  })
})

describe('capGroundInk', () => {
  it('leaves the boards’ grounds as they are', () => {
    for (const ground of ['#293143', '#273246', '#402D26']) {
      expect(printFinalTotalInk(ground)).toBeLessThan(PRINT_FINAL_GROUND_INK_CAP)
      expect(capGroundInk(ground)).toBe(ground)
    }
  })

  it('lifts a near-black ground to the cap, keeping its hue', () => {
    const lifted = capGroundInk('#05070C')
    expect(printFinalTotalInk(lifted)).toBeLessThanOrEqual(PRINT_FINAL_GROUND_INK_CAP)
    expect(printFinalTotalInk(lifted)).toBeGreaterThan(PRINT_FINAL_GROUND_INK_CAP - 0.05)
    expect(contrastRatio('#FFFFFF', lifted)).toBeGreaterThan(10.5)
  })
})

describe('printFinalImmersivePalette', () => {
  const oakmere = (
    over: Partial<Parameters<typeof printFinalImmersivePalette>[0]> = {},
  ) =>
    printFinalImmersivePalette({
      accentColour: '#D4E3FE',
      fieldColour: '#001E57',
      sample: sampleOf(
        [120, 120, 120],
        [132.25, 117.87, 101.062].map(Math.round) as never,
      ),
      orientation: 'upright',
      languageCount: 1,
      ...over,
    })

  it('paints the board’s washes, fold strip and bar on Oakmere', () => {
    const palette = oakmere()
    expect(palette.ground).toBe('#293143')
    expect(palette.warm).toBe('#6A97D4')
    expect(palette.cool).toBe('#745C73')
    expect(palette.foldStrip).toBe('#E2DED6')
    expect(palette.barText).toBe('#121614')
    expect(contrastRatio(palette.barFill, palette.barText)).toBeGreaterThanOrEqual(4.5)
  })

  it('holds the kicker against the brighter of the ground and the photo’s middle', () => {
    const palette = oakmere()
    expect(contrastRatio(palette.kicker, palette.kickerGround)).toBeGreaterThanOrEqual(
      4.5,
    )
    const dark = oakmere({ sample: sampleOf([2, 2, 2]) })
    expect(dark.kickerGround).toBe(dark.ground)
  })

  it('uses the property’s field as the ground with no photo', () => {
    const palette = oakmere({ sample: null, fieldColour: '#232323' })
    expect(palette.ground).toBe('#232323')
    expect(palette.kickerGround).toBe('#232323')
    expect(contrastRatio(palette.kicker, '#232323')).toBeGreaterThanOrEqual(4.5)
  })
})
