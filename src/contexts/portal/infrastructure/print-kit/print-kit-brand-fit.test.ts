import { describe, expect, it } from 'vitest'
import { FIT, WINDOW, ptToMm } from '#/shared/domain/portal-print-kit-measures'
import type { BrandPlan } from './print-kit-face-brand'
import {
  faceOf,
  layOutImmersive,
  layOutPaper,
  wordsToCode,
} from './__fixtures__/print-kit-face-fixtures'

// The brand ranks last of everything a face keeps (spec 2.5): before the place
// label steps down, and before the window is dropped, a logo gives up its size
// to its 10 mm floor. Once the type has stepped down it is full again if it fits.

const logoHeightMm = (plan: BrandPlan) =>
  plan.kind === 'logo' ? ptToMm(plan.imageHeightPt) : Number.NaN

const twoLanguages = (en: string) =>
  faceOf({ piece: 'counter_card', languages: ['en', 'es'] }, { en, es: 'Piscina' })

describe('a logo on a tight face', () => {
  it('shrinks to its floor before the place label steps down, on the Immersive A6 card', async () => {
    const layout = await layOutImmersive(
      twoLanguages('The terrace bar by the pool and the garden'),
      'cardA6',
      { logo: true },
    )
    expect(layout.stack.stack.first?.style.size).toBe(24)
    expect(logoHeightMm(layout.brand.plan)).toBeCloseTo(ptToMm(FIT.logoFloorPt), 6)
    expect(wordsToCode(layout)).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
  })

  it('shrinks to its floor before the place label steps down, on the Paper 4 × 6 in card', async () => {
    const layout = await layOutPaper(
      twoLanguages('The terrace bar by the pool'),
      'card4x6',
      { logo: true },
    )
    expect(layout.stack.stack.first?.style.size).toBe(24)
    expect(logoHeightMm(layout.brand.plan)).toBeCloseTo(ptToMm(FIT.logoFloorPt), 6)
  })

  it('is full again once the type has stepped down, if it fits', async () => {
    const layout = await layOutPaper(
      twoLanguages('The terrace bar by the pool and the garden restaurant'),
      'card4x6',
      { logo: true },
    )
    expect(layout.stack.stack.first?.style.size).toBe(22)
    expect(logoHeightMm(layout.brand.plan)).toBeCloseTo(14.7, 1)
  })

  it('shrinks to its floor before the window is dropped, on the Immersive A6 tent panel', async () => {
    const layout = await layOutImmersive(
      faceOf({ piece: 'table_tent', languages: ['en'] }),
      'tentPanelA6',
      { logo: true },
    )
    expect(layout.window?.picture.heightPt ?? 0).toBeGreaterThanOrEqual(WINDOW.minPt)
    expect(logoHeightMm(layout.brand.plan)).toBeCloseTo(ptToMm(FIT.logoFloorPt), 6)
  })

  it('shrinks to its floor before the window is dropped, on an Immersive card', async () => {
    // A logo 15 mm tall at full size, drawn to the file's top edge: no transparent edge to spare.
    const layout = await layOutImmersive(
      faceOf({ piece: 'counter_card', languages: ['en'] }, { en: 'Pool & Terrace' }),
      'cardA6',
      { logo: { height: 225, edge: 0 } },
    )
    expect(layout.window?.picture.heightPt ?? 0).toBeGreaterThanOrEqual(WINDOW.minPt)
    expect(logoHeightMm(layout.brand.plan)).toBeCloseTo(ptToMm(FIT.logoFloorPt), 6)
    expect(layout.stack.stack.first?.style.size).toBe(32)
  })
})
