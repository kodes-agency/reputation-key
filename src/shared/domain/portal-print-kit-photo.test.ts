import { describe, expect, it } from 'vitest'
import { PRINT_KIT_PAPERS } from './portal-print-kit'
import { printKitSheetPages } from './portal-print-kit-formats'
import { CODE_TILE } from './portal-print-kit-code-tile'
import { inToPt } from './portal-print-kit-measures'
import { PORTAL_MEDIA_SIZE_RULES, PRINT_PHOTO_MIN_WIDTH_PX } from './portal-media'
import {
  cardBandArea,
  photoPrintDpi,
  tentPanelArea,
  type PhotoArea,
} from './portal-print-kit-photo'
import { PANEL_SIZE_PT } from './portal-print-kit-sheets'
import { BAND, BAND_PHOTO_DPI } from './portal-print-kit-sizes'

const NO_BLEED = { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }

/** The Large band as the 4 × 6 in card prints it at a print shop: 4 in across plus a bleed each side, 1.3 in down plus a bleed above. */
const LARGE_BAND: PhotoArea = {
  widthPt: inToPt(4 + 2 / 8),
  heightPt: inToPt(1.3 + 1 / 8),
}

describe('photoPrintDpi', () => {
  it('is the photo’s width over the area’s width when the width is what runs short', () => {
    // A portrait photo 500 × 1000 across 4.25 in: the band is 3 times wider than tall.
    expect(photoPrintDpi({ widthPx: 500, heightPx: 1000 }, LARGE_BAND)).toBeCloseTo(
      500 / 4.25,
      6,
    )
  })

  it('is the photo’s height over the area’s height when the height is what runs short', () => {
    // A very wide, short photo covering a tall area is enlarged by its height.
    const tall: PhotoArea = { widthPt: inToPt(1), heightPt: inToPt(4) }
    expect(photoPrintDpi({ widthPx: 3000, heightPx: 400 }, tall)).toBeCloseTo(100, 6)
  })

  it('takes the lesser side, so a photo that fills the area with room to spare is sharp', () => {
    expect(photoPrintDpi({ widthPx: 1600, heightPx: 1000 }, LARGE_BAND)).toBeCloseTo(
      1600 / 4.25,
      6,
    )
  })

  it('reads 4 000 px over 4.25 in as sharp enough and 750 px as soft, by the one threshold', () => {
    const sharp = photoPrintDpi({ widthPx: 4000, heightPx: 3000 }, LARGE_BAND)
    const soft = photoPrintDpi({ widthPx: 750, heightPx: 450 }, LARGE_BAND)
    expect(sharp).toBeGreaterThanOrEqual(BAND_PHOTO_DPI.warnBelow)
    expect(soft).toBeLessThan(BAND_PHOTO_DPI.warnBelow)
  })
})

describe('the areas a face shows the photo in', () => {
  const leftAndTop = { ...NO_BLEED, topPt: 9, leftPt: 9 }

  it('runs a card’s band into the bleed on the top and each side that bleeds', () => {
    expect(
      cardBandArea({ widthPt: 288, bandPt: 93.6 }, { ...leftAndTop, rightPt: 9 }),
    ).toEqual({ widthPt: 306, heightPt: 102.6 })
    expect(cardBandArea({ widthPt: 288, bandPt: 93.6 }, NO_BLEED)).toEqual({
      widthPt: 288,
      heightPt: 93.6,
    })
  })

  it('has no band on a card that has none', () => {
    expect(cardBandArea({ widthPt: 288, bandPt: null }, leftAndTop)).toBeNull()
  })

  it('runs a tent’s panel into the bleed on the left, top and foot', () => {
    expect(
      tentPanelArea({ panelPt: 86.4, heightPt: 252 }, { ...leftAndTop, bottomPt: 9 }),
    ).toEqual({ widthPt: 95.4, heightPt: 270 })
  })

  it('has no panel on a tent that has none', () => {
    expect(tentPanelArea({ panelPt: null, heightPt: 252 }, leftAndTop)).toBeNull()
  })
})

describe('the upload hint and the print agree', () => {
  it('asks for a width the server’s own rule already allows, and more than its short edge', () => {
    const { minLongEdge, minShortEdge } = PORTAL_MEDIA_SIZE_RULES.hero
    expect(PRINT_PHOTO_MIN_WIDTH_PX).toBeGreaterThanOrEqual(minLongEdge)
    expect(PRINT_PHOTO_MIN_WIDTH_PX).toBeGreaterThan(minShortEdge)
  })

  it('prints the smallest photo it accepts sharp on every Large card sheet', () => {
    // 1000 px wide and as short as the server lets a photo be: 500 px.
    const smallest = {
      widthPx: PRINT_PHOTO_MIN_WIDTH_PX,
      heightPx: PORTAL_MEDIA_SIZE_RULES.hero.minShortEdge,
    }
    const dpis = PRINT_KIT_PAPERS.flatMap((paper) =>
      (['print_shop', 'office'] as const).flatMap((output) =>
        printKitSheetPages({
          piece: 'counter_card',
          size: 'large',
          style: 'immersive',
          output,
          languageCount: 1,
          paper,
          faceCount: 2,
          tilePt: CODE_TILE.large.letter.tilePt,
        }).flatMap((page) =>
          page.panels.map((panel) => {
            const trim = PANEL_SIZE_PT[panel.geometry]
            // The band at its target: it gives way to its minimum only when a face is tight.
            const area = cardBandArea(
              { widthPt: trim.widthPt, bandPt: BAND.large.minPt },
              panel.bleed,
            )
            return area === null ? Number.NaN : photoPrintDpi(smallest, area)
          }),
        ),
      ),
    )
    expect(dpis.length).toBeGreaterThan(0)
    expect(Math.min(...dpis)).toBeGreaterThanOrEqual(BAND_PHOTO_DPI.warnBelow)
  })

  it('does not print the portrait photo the old rule let in sharp', () => {
    // 500 × 1000 passes the server's rule (1000 long, 500 short) and the 4.25 in band is 3 times wider than tall.
    const dpi = photoPrintDpi({ widthPx: 500, heightPx: 1000 }, LARGE_BAND)
    expect(dpi).toBeLessThan(BAND_PHOTO_DPI.warnBelow)
  })
})
