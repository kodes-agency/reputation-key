import { describe, expect, it } from 'vitest'
import { printFinalBlocks } from './portal-print-final-languages'
import type { PrintFinalFace } from './portal-print-final'
import { printFinalArt, type PrintFinalArt } from './portal-print-final-art'
import { choosePrintFinalTile } from './portal-print-final-code'
import { layoutPrintFinalFace } from './portal-print-final-face'
import {
  printFinalFraming,
  printFinalFramingOf,
  printFinalPhotoCrop,
} from './portal-print-final-framing'
import type { PrintFinalImmersivePalette } from './portal-print-final-immersive'
import { rampAlpha, washAlpha } from './portal-print-final-layers'
import { inPt, mmPt } from './portal-print-final-measures'
import type { PrintFinalPlan } from './portal-print-final-plan'
import type { PrintFinalTextMeasurer } from './portal-print-final-text'

// The Immersive art against the generator that drew the boards
// (final-engine.mjs, layoutCard): the photo box and its fade, the box with
// bleed the photo is cropped to cover, the scrims, the no-photo ground and the
// tent's fold strip.

const measurer: PrintFinalTextMeasurer = {
  advancePt: (text, style) => style.sizePt * text.length * 0.5,
  ink: (text, style) => ({
    leftPt: 0,
    rightPt: style.sizePt * text.length * 0.5,
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.2 * style.sizePt,
  }),
}

const PALETTE: PrintFinalImmersivePalette = {
  ground: '#293143',
  warm: '#6A97D4',
  cool: '#745C73',
  accentLine: '#D4E3FE',
  kicker: '#FFFFFF',
  kickerGround: '#808080',
  foldStrip: '#E2DED6',
  barFill: '#D4E3FE',
  barText: '#121614',
}

const immersive = (
  piece: PrintFinalFace['piece'],
  orientation: PrintFinalFace['orientation'],
): PrintFinalFace => ({ piece, orientation, look: 'immersive', region: 'us' })

function planOf(
  face: PrintFinalFace,
  languages: readonly ('en' | 'es')[] = ['en'],
): PrintFinalPlan {
  const blocks = printFinalBlocks(
    languages,
    'rate',
    { en: 'Reception', es: 'Recepción' },
    'Reception',
  )
  const tile = choosePrintFinalTile({ ...face, address: 'short', symbolModules: 29 })
  return layoutPrintFinalFace({
    face,
    blocks,
    brand: { kind: 'logo', inkWidth: 1.4, inkHeight: 1, onPlate: true },
    tile: tile._unsafeUnwrap(),
    measurer,
  }).plan
}

const artOf = (
  plan: PrintFinalPlan,
  over: Partial<Parameters<typeof printFinalArt>[0]> = {},
): PrintFinalArt =>
  printFinalArt({
    plan,
    palette: PALETTE,
    hasPhoto: true,
    languageCount: 1,
    boost: 0,
    ...over,
  })

const BLEED = inPt(1 / 8)

describe('printFinalArt: the photo', () => {
  it('runs upright from the top trim to 0.12 in above the code, its lower 48 % fading', () => {
    const plan = planOf(immersive('counter', 'upright'))
    const photo = artOf(plan).photo
    const bottom = plan.code.topPt - inPt(0.12)
    expect(photo?.box).toEqual({
      leftPt: 0,
      topPt: 0,
      rightPt: plan.widthPt,
      bottomPt: bottom,
    })
    expect(photo?.fade.axis).toBe('y')
    expect(rampAlpha(photo!.fade, bottom * 0.52)).toBeCloseTo(1)
    expect(rampAlpha(photo!.fade, bottom * 0.76)).toBeCloseTo(0.5)
    expect(rampAlpha(photo!.fade, bottom)).toBe(0)
  })

  it('is cropped to cover its box with the bleed on the left, right and top, drawn or not', () => {
    const plan = planOf(immersive('counter', 'upright'))
    const photo = artOf(plan).photo!
    expect(photo.cover.leftPt).toBeCloseTo(-BLEED)
    expect(photo.cover.rightPt).toBeCloseTo(plan.widthPt + BLEED)
    expect(photo.cover.topPt).toBeCloseTo(-BLEED)
    expect(photo.cover.bottomPt).toBe(photo.box.bottomPt)
    expect(photo.cover.rightPt - photo.cover.leftPt).toBeCloseTo(
      photo.measure.coverWidthPt,
    )
    expect(photo.cover.bottomPt - photo.cover.topPt).toBeCloseTo(
      photo.measure.coverHeightPt,
    )
  })

  it('runs wide from the left trim to the tile at full height, fading toward the tile', () => {
    const plan = planOf(immersive('counter', 'wide'))
    const photo = artOf(plan).photo!
    expect(photo.box).toEqual({
      leftPt: 0,
      topPt: 0,
      rightPt: plan.code.leftPt,
      bottomPt: plan.heightPt,
    })
    expect(photo.fade.axis).toBe('x')
    expect(rampAlpha(photo.fade, plan.code.leftPt * 0.76)).toBeCloseTo(0.5)
    expect(photo.cover.bottomPt).toBeCloseTo(plan.heightPt + BLEED)
    expect(photo.cover.rightPt).toBe(plan.code.leftPt)
  })

  it('starts below a tent’s fold strip and takes no bleed there', () => {
    const plan = planOf(immersive('tent', 'upright'))
    const art = artOf(plan, {
      bleed: { leftPt: BLEED, topPt: BLEED, rightPt: BLEED, bottomPt: BLEED },
    })
    expect(art.photo?.box.topPt).toBeCloseTo(inPt(0.1))
    expect(art.photo?.cover.topPt).toBeCloseTo(inPt(0.1))
    expect(art.foldStrip).toEqual({
      box: {
        leftPt: -BLEED,
        topPt: 0,
        rightPt: plan.widthPt + BLEED,
        bottomPt: inPt(0.1),
      },
      colour: '#E2DED6',
    })
  })

  it('runs the ground and the photo into a drawn bleed on the edges they touch', () => {
    const plan = planOf(immersive('small', 'wide'))
    const art = artOf(plan, {
      bleed: { leftPt: BLEED, topPt: BLEED, rightPt: BLEED, bottomPt: BLEED },
    })
    expect(art.groundBox).toEqual({
      leftPt: -BLEED,
      topPt: -BLEED,
      rightPt: plan.widthPt + BLEED,
      bottomPt: plan.heightPt + BLEED,
    })
    expect(art.photo?.box.leftPt).toBe(-BLEED)
    expect(art.photo?.box.rightPt).toBe(plan.code.leftPt)
  })
})

describe('printFinalArt: the scrims', () => {
  it('runs the top scrim to 0.5 in below the brand, 0.50 at the trim and 0.40 at 45 %', () => {
    const plan = planOf(immersive('counter', 'upright'))
    const [top] = artOf(plan).scrims
    const end = (plan.groups.brand?.bottomPt ?? 0) + inPt(0.5)
    expect(top?.box.bottomPt).toBeCloseTo(end)
    expect(rampAlpha(top!.ramps[0]!, 0)).toBeCloseTo(0.5)
    expect(rampAlpha(top!.ramps[0]!, 0.45 * end)).toBeCloseTo(0.4)
    expect(rampAlpha(top!.ramps[0]!, end)).toBe(0)
  })

  it.each([
    ['upright', 1, 0.5],
    ['upright', 2, 0.56],
    ['wide', 1, 0.66],
    ['wide', 2, 0.7],
  ] as const)(
    'holds the %s message scrim with %i language(s) at %f',
    (orientation, count, alpha) => {
      const plan = planOf(
        immersive('counter', orientation),
        count === 2 ? ['en', 'es'] : ['en'],
      )
      const message = artOf(plan, { languageCount: count }).scrims[1]!
      const middle =
        ((plan.groups.message?.topPt ?? 0) + (plan.groups.message?.bottomPt ?? 0)) / 2
      expect(rampAlpha(message.ramps[0]!, middle)).toBeCloseTo(alpha)
    },
  )

  it('reaches 0.45 in above and 0.35 in below the message upright; 0.55 in each way wide, and 0.7 in past the words', () => {
    const upright = planOf(immersive('counter', 'upright'))
    const box = artOf(upright).scrims[1]!.box
    expect(box.topPt).toBeCloseTo(upright.groups.message!.topPt - inPt(0.45))
    expect(box.bottomPt).toBeCloseTo(upright.groups.message!.bottomPt + inPt(0.35))
    const wide = planOf(immersive('counter', 'wide'))
    const scrim = artOf(wide).scrims[1]!
    expect(scrim.box.topPt).toBeCloseTo(wide.groups.message!.topPt - inPt(0.55))
    expect(scrim.box.rightPt).toBeCloseTo(wide.column.rightPt + inPt(0.7))
    expect(rampAlpha(scrim.ramps[1]!, wide.column.rightPt)).toBe(1)
    expect(rampAlpha(scrim.ramps[1]!, wide.column.rightPt + inPt(0.35))).toBeCloseTo(0.5)
  })

  it('deepens both by the boost, the message scrim never past 0.9', () => {
    const plan = planOf(immersive('counter', 'wide'), ['en', 'es'])
    const [top, message] = artOf(plan, { languageCount: 2, boost: 0.3 }).scrims
    expect(rampAlpha(top!.ramps[0]!, 0)).toBeCloseTo(0.8)
    const middle = (plan.groups.message!.topPt + plan.groups.message!.bottomPt) / 2
    expect(rampAlpha(message!.ramps[0]!, middle)).toBeCloseTo(0.9)
  })
})

describe('printFinalArt: no photo', () => {
  it('paints the brighter washes and the arch on an upright face, no scrims', () => {
    const plan = planOf(immersive('counter', 'upright'))
    const art = artOf(plan, { hasPhoto: false })
    expect(art.photo).toBeNull()
    expect(art.scrims).toEqual([])
    expect(art.grainOpacity).toBe(0.04)
    expect(art.washes.map((wash) => wash.alpha)).toEqual([0.55, 0.55, 0.16])
    expect(art.arch?.box.leftPt).toBeCloseTo(0.19 * plan.widthPt)
    expect(art.arch?.box.topPt).toBeCloseTo(plan.groups.brand!.topPt - inPt(0.08))
    expect(art.arch?.box.bottomPt).toBeCloseTo(plan.code.topPt - inPt(0.12))
    expect(art.arch?.opacity).toBe(0.42)
  })

  it('draws no arch on a wide face', () => {
    expect(artOf(planOf(immersive('tent', 'wide')), { hasPhoto: false }).arch).toBeNull()
  })

  it('fades a wash to nothing at its fade share of its radii', () => {
    const [warm] = artOf(planOf(immersive('counter', 'upright'))).washes
    expect(washAlpha(warm!, warm!.xPt, warm!.yPt)).toBeCloseTo(0.3)
    expect(washAlpha(warm!, warm!.xPt + warm!.rxPt * 0.36, warm!.yPt)).toBeCloseTo(0.15)
    expect(washAlpha(warm!, warm!.xPt + warm!.rxPt * 0.72, warm!.yPt)).toBe(0)
  })
})

describe('printFinalPhotoCrop', () => {
  const photo = { widthPx: 1200, heightPx: 600 }
  const cover = { widthPt: 300, heightPt: 300 }

  it('covers the box at the focal point at zoom 1', () => {
    expect(printFinalPhotoCrop(photo, cover, { x: 0.5, y: 0.5 })).toEqual({
      leftPx: 300,
      topPx: 0,
      widthPx: 600,
      heightPx: 600,
    })
    expect(printFinalPhotoCrop(photo, cover, { x: 0, y: 0.5 }).leftPx).toBe(0)
  })

  it('zooms into the window the anchor names, at a lower resolution', () => {
    const crop = printFinalPhotoCrop(
      photo,
      cover,
      { x: 0.5, y: 0.5 },
      printFinalFraming({ zoom: 1.5, anchorX: 0.5, anchorY: 1 }),
    )
    expect(crop.widthPx).toBeCloseTo(400)
    expect(crop.topPx + crop.heightPx).toBeCloseTo(600)
    expect(crop.leftPx).toBeCloseTo(400)
  })

  it('holds a framing to its ranges and finds a face’s own', () => {
    expect(printFinalFraming({ zoom: 3, anchorX: -1, anchorY: Number.NaN })).toEqual({
      zoom: 1.5,
      anchorX: 0,
      anchorY: 0,
    })
    const framings = { 'counter-wide': { zoom: 1.35, anchorX: 0, anchorY: 1 } }
    expect(
      printFinalFramingOf(framings, { piece: 'counter', orientation: 'wide' }).zoom,
    ).toBe(1.35)
    expect(
      printFinalFramingOf(framings, { piece: 'counter', orientation: 'upright' }).zoom,
    ).toBe(1)
  })
})

it('keeps the photo box with bleed of the boards: 4.25 × 3.59 in on the upright Counter card', () => {
  const plan = planOf(immersive('counter', 'upright'))
  const photo = artOf(plan).photo!
  expect(photo.measure.coverWidthPt).toBeCloseTo(inPt(4.25))
  expect(Math.abs(photo.measure.coverHeightPt - inPt(3.59))).toBeLessThan(mmPt(3))
})
