import { describe, expect, it } from 'vitest'
import type { GuestLocale } from './guest-locale'
import { printFinalBlocks } from './portal-print-final-languages'
import type { PrintFinalFace } from './portal-print-final'
import { choosePrintFinalTile } from './portal-print-final-code'
import type { PrintFinalScenePhoto } from './portal-print-final-contrast'
import { PRINT_FINAL_DEFAULT_FRAMING } from './portal-print-final-framing'
import {
  layoutPrintFinalImmersiveFace,
  type PrintFinalImmersiveBrand,
  type PrintFinalImmersiveFaceInput,
} from './portal-print-final-immersive-face'
import type { PrintFinalPhotoSample } from './portal-print-final-photo-sample'
import type { PrintFinalTextMeasurer } from './portal-print-final-text'

// An Immersive face reads its photo's pixels twice: to deepen the scrims until
// every word reaches 4.5:1 (with a tenth to spare) against the brightest of what
// lies under it, and to decide whether a light logo may sit straight on the
// photo. The photos here are flat colours, so the outcome is plain.

const measurer: PrintFinalTextMeasurer = {
  advancePt: (text, style) => style.sizePt * text.length * 0.5,
  ink: (text, style) => ({
    leftPt: 0,
    rightPt: style.sizePt * text.length * 0.5,
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.2 * style.sizePt,
  }),
}

function flat(rgb: readonly [number, number, number]): PrintFinalScenePhoto {
  const widthPx = 240
  const heightPx = 160
  const data = new Uint8ClampedArray(widthPx * heightPx * 3)
  for (let at = 0; at < data.length; at += 3) data.set(rgb, at)
  const sample: PrintFinalPhotoSample = { widthPx, heightPx, rgb: data }
  return {
    sample,
    detail: sample,
    pixels: { widthPx: 1620, heightPx: 1080 },
    focal: { x: 0.5, y: 0.4 },
    framing: PRINT_FINAL_DEFAULT_FRAMING,
  }
}

/** A dark photo with a bright band (a window, a pale sky) across rows `from` to `to` of its height. */
function bandedPhoto(from: number, to: number): PrintFinalScenePhoto {
  const widthPx = 240
  const heightPx = 160
  const data = new Uint8ClampedArray(widthPx * heightPx * 3)
  for (let row = 0; row < heightPx; row++) {
    const level = row / heightPx >= from && row / heightPx < to ? 255 : 30
    for (let column = 0; column < widthPx; column++) {
      data.set([level, level * 0.95, level * 0.9], (row * widthPx + column) * 3)
    }
  }
  const sample: PrintFinalPhotoSample = { widthPx, heightPx, rgb: data }
  return { ...flat([0, 0, 0]), sample, detail: sample }
}

const immersive = (
  piece: PrintFinalFace['piece'],
  orientation: PrintFinalFace['orientation'],
): PrintFinalFace => ({ piece, orientation, look: 'immersive', region: 'us' })

function inputFor(
  face: PrintFinalFace,
  over: Partial<PrintFinalImmersiveFaceInput> = {},
  languages: readonly GuestLocale[] = ['en'],
): PrintFinalImmersiveFaceInput {
  const blocks = printFinalBlocks(
    languages,
    { preset: 'how_did_we_do' },
    { en: 'Review us on Google' },
    'Reception',
  )
  const tile = choosePrintFinalTile({ ...face, address: 'short', symbolModules: 29 })
  return {
    face,
    blocks,
    brand: { kind: 'wordmark', text: 'Hotel Elegance' },
    tile: tile._unsafeUnwrap(),
    measurer,
    accentColour: '#E3B873',
    fieldColour: '#2A1712',
    photo: flat([40, 40, 40]),
    ...over,
  }
}

const lowest = (ratios: readonly { ratio: number }[]) =>
  Math.min(...ratios.map((r) => r.ratio))

describe('layoutPrintFinalImmersiveFace: the scrims', () => {
  it('leaves them as they are over a dark photo', () => {
    const laid = layoutPrintFinalImmersiveFace(inputFor(immersive('counter', 'upright')))
    expect(laid.boost).toEqual({ top: 0, message: 0, clear: 0, clearFrom: 'message' })
    expect(lowest(laid.contrasts)).toBeGreaterThan(4.6)
    expect(laid.contrasts.map((c) => c.key)).toEqual([
      'brand',
      'kicker',
      'headline',
      'subline',
    ])
  })

  it('deepens 0.06 at a time over a light photo until every word reads', () => {
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(immersive('counter', 'upright'), { photo: flat([200, 190, 185]) }),
    )
    expect(laid.boost.top + laid.boost.clear).toBeGreaterThan(0)
    expect(Math.round(laid.boost.top * 100) % 6).toBe(0)
    expect(Math.round(laid.boost.clear * 100) % 6).toBe(0)
    expect(lowest(laid.contrasts)).toBeGreaterThanOrEqual(4.6)
  })

  it('deepens over a white photo, the top never past 0.30 and the clearing never past 0.60', () => {
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(immersive('small', 'upright'), { photo: flat([255, 255, 255]) }),
    )
    expect(laid.boost.top).toBeGreaterThan(0.06)
    expect(laid.boost.top).toBeLessThanOrEqual(0.3)
    expect(laid.boost.clear).toBeLessThanOrEqual(0.6)
    expect(lowest(laid.contrasts)).toBeGreaterThanOrEqual(4.6)
  })

  it('deepens the top scrim for the brand only, never the message for it', () => {
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(immersive('tent', 'upright'), { photo: flat([120, 115, 110]) }),
    )
    const message = laid.contrasts.filter((c) => c.key !== 'brand')
    if (laid.boost.clear > 0) expect(laid.boost.clearFrom).toBe('brand')
    expect(lowest(message)).toBeGreaterThanOrEqual(4.6)
  })

  it('deepens the message scrim, on the photo, only once the photo is melted as far as it goes', () => {
    // A bright band behind the kicker of a wide tent in two languages: the
    // photo melting into the ground is not enough for a blue kicker, so the
    // message scrim helps last (it read 3.9:1 before it could).
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(
        immersive('tent', 'wide'),
        {
          photo: bandedPhoto(0.1, 0.35),
          accentColour: '#2563EB',
          fieldColour: '#0E1016',
        },
        ['en', 'es'],
      ),
    )
    expect(laid.boost.clear).toBe(0.6)
    expect(laid.boost.message).toBeGreaterThan(0)
    expect(laid.boost.message).toBeLessThanOrEqual(0.3)
    expect(lowest(laid.contrasts)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves the message scrim alone while the clearing is enough', () => {
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(immersive('tent', 'upright'), { photo: flat([200, 190, 185]) }),
    )
    expect(laid.boost.message).toBe(0)
  })

  it('paints no scrims and no boost without a photo', () => {
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(immersive('tent', 'wide'), { photo: null, fieldColour: '#232323' }),
    )
    expect(laid.boost).toEqual({ top: 0, message: 0, clear: 0, clearFrom: 'message' })
    expect(laid.art.scrims).toEqual([])
    expect(laid.palette.ground).toBe('#232323')
    expect(lowest(laid.contrasts)).toBeGreaterThan(4.5)
  })

  it('paints the words white and off-white, the kicker in its tint', () => {
    const laid = layoutPrintFinalImmersiveFace(inputFor(immersive('counter', 'wide')))
    expect(laid.colours).toMatchObject({ ink: '#FFFFFF', soft: '#F6F1E8', outline: null })
    expect(laid.colours.accent).toBe(laid.palette.kicker)
  })
})

describe('layoutPrintFinalImmersiveFace: the plate', () => {
  const logo = (median: number | null): PrintFinalImmersiveBrand => ({
    kind: 'logo',
    inkWidth: 1.4,
    inkHeight: 1,
    medianInkLuminance: median,
  })

  it('puts a dark or a mid-tone logo on the plate', () => {
    for (const median of [0.02, 0.09, 0.39]) {
      const laid = layoutPrintFinalImmersiveFace(
        inputFor(immersive('counter', 'upright'), { brand: logo(median) }),
      )
      expect(laid.logoOnPlate).toBe(true)
    }
  })

  it('puts a logo whose ink could not be read on the plate', () => {
    const laid = layoutPrintFinalImmersiveFace(
      inputFor(immersive('tent', 'wide'), { brand: logo(null) }),
    )
    expect(laid.logoOnPlate).toBe(true)
  })

  it('lets a white logo sit straight on a dark photo, but not on a light one', () => {
    const dark = layoutPrintFinalImmersiveFace(
      inputFor(immersive('counter', 'upright'), { brand: logo(0.9) }),
    )
    expect(dark.logoOnPlate).toBe(false)
    const light = layoutPrintFinalImmersiveFace(
      inputFor(immersive('counter', 'upright'), {
        brand: logo(0.9),
        photo: flat([235, 235, 235]),
      }),
    )
    expect(light.logoOnPlate).toBe(true)
  })

  it('sizes the plate with its padding round the logo', () => {
    const plated = layoutPrintFinalImmersiveFace(
      inputFor(immersive('counter', 'upright'), { brand: logo(0.02) }),
    )
    const brand = plated.layout.plan.parts.find((part) => part.key === 'brand')
    const content = plated.layout.contents[0]
    expect(content?.kind).toBe('logo')
    if (content?.kind !== 'logo') return
    expect(brand?.heightPt).toBeCloseTo(
      content.box.logo.heightPt + 2 * content.box.paddingPt.v,
    )
    expect(content.box.paddingPt.v).toBeGreaterThan(0)
  })
})
