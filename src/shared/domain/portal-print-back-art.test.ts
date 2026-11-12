import { describe, expect, it } from 'vitest'
import type { PrintFace } from './portal-print'
import { printBackArt } from './portal-print-art'
import { layoutPrintBack } from './portal-print-back'
import { printImmersiveColours } from './portal-print-colours'
import { printScene, printTextContrast } from './portal-print-contrast'
import { printImmersivePalette } from './portal-print-immersive'
import { PRINT_NO_BLEED } from './portal-print-layers'
import { PRINT_DISTANCES } from './portal-print-measures'
import type { PrintTextMeasurer } from './portal-print-text'

// The back page's art (§10.4): the front's ground and washes, with no photo.

const measurer: PrintTextMeasurer = {
  advancePt: (text, style) => style.sizePt * text.length * 0.5,
  ink: (text, style) => ({
    leftPt: 0,
    rightPt: style.sizePt * text.length * 0.5,
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.2 * style.sizePt,
  }),
}

const face = (piece: 'counter' | 'small', orientation: 'upright' | 'wide') =>
  ({ piece, orientation, look: 'immersive', region: 'us' }) satisfies PrintFace

const palette = (fieldColour: string) =>
  printImmersivePalette({
    accentColour: '#A8C6FE',
    fieldColour,
    sample: null,
    orientation: 'upright',
    languageCount: 1,
  })

const SIZE = { widthPt: 288, heightPt: 432 }

describe('printBackArt', () => {
  it('is the ground and the guest page’s two washes, with no photo, scrims, arch or fold strip', () => {
    const art = printBackArt(SIZE, palette('#16224A'))
    expect(art.ground).toBe(palette('#16224A').ground)
    expect(art.photo).toBeNull()
    expect(art.scrims).toEqual([])
    expect(art.arch).toBeNull()
    expect(art.foldStrip).toBeNull()
    expect(art.washes).toHaveLength(2)
    expect(art.washes.map((wash) => wash.alpha)).toEqual([0.3, 0.3])
    expect(art.grainOpacity).toBe(0.05)
  })

  it('draws the washes where the front’s photo faces draw them: warm at the bottom left, cool at the right', () => {
    const [warm, cool] = printBackArt(SIZE, palette('#16224A')).washes
    expect([warm?.xPt, warm?.yPt]).toEqual([0, 432])
    expect([cool?.xPt, cool?.yPt]).toEqual([288, 0.56 * 432])
  })

  it('runs the ground into the bleed on every edge: none on a lone card, the sheet’s on a sheet', () => {
    expect(printBackArt(SIZE, palette('#16224A')).groundBox).toEqual({
      leftPt: 0,
      topPt: 0,
      rightPt: 288,
      bottomPt: 432,
    })
    const amount = PRINT_DISTANCES.bleedPt.us
    const bleed = { leftPt: amount, topPt: amount, rightPt: amount, bottomPt: amount }
    expect(printBackArt(SIZE, palette('#16224A'), bleed).groundBox).toEqual({
      leftPt: -amount,
      topPt: -amount,
      rightPt: 288 + amount,
      bottomPt: 432 + amount,
    })
    expect(PRINT_NO_BLEED.leftPt).toBe(0)
  })

  it.each([
    ['counter', 'upright'],
    ['small', 'wide'],
  ] as const)(
    'keeps the %s %s name and wordmark at 4.5:1 or better against the ground and washes',
    (piece, orientation) => {
      const f = face(piece, orientation)
      const art = printBackArt(
        piece === 'counter' ? SIZE : { widthPt: 252, heightPt: 144 },
        palette('#16224A'),
      )
      const colours = printImmersiveColours(palette('#16224A'))
      const { plan } = layoutPrintBack({
        face: f,
        brand: { kind: 'wordmark', text: 'Hotel Elegance' },
        propertyName: 'Hotel Elegance Lisbon Baixa',
        measurer,
      })
      const scene = printScene(art, null)
      for (const part of plan.parts) {
        const colour = part.key === 'name' ? colours.soft : colours.ink
        const box = {
          leftPt: part.xPt,
          topPt: part.yPt,
          rightPt: part.xPt + part.widthPt,
          bottomPt: part.yPt + part.heightPt,
        }
        expect(printTextContrast(scene, box, colour)).toBeGreaterThanOrEqual(4.5)
      }
    },
  )
})
