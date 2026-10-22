import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { printKitFaces, type PrintKitChoice } from '#/shared/domain/portal-print-kit'
import { FIT } from '#/shared/domain/portal-print-kit-measures'
import { immersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  immersiveBackground,
  previewImmersiveFit,
  printKitPrintShopLabel,
} from './print-kit-immersive-art-layout'

const POOL = { en: 'Pool & Terrace', es: 'Piscina y terraza', bg: 'Басейн и тераса' }

const frontOf = (
  choice: PrintKitChoice,
  titles: Readonly<Record<string, string>> = POOL,
) => {
  const [front] = printKitFaces(choice, titles, 'Portal')
  if (front === undefined) throw new Error('no face')
  return front
}

const choice = (
  piece: PrintKitChoice['piece'],
  languages: PrintKitChoice['languages'],
  callToAction: PrintKitChoice['callToAction'] = 'rate',
): PrintKitChoice => ({ piece, languages, callToAction })

const look = (logoUrl: string | null = null): PortalPrintKitView['look'] => ({
  wordmark: 'Avela',
  accentColour: '#EAD6A8',
  fieldColour: '#16130E',
  heroUrl: null,
  heroFocal: null,
  logoUrl,
})

describe('previewImmersiveFit', () => {
  // The PDF's choices on the boards (print-kit-immersive-face.test.ts measures them).
  it('keeps the full scale and 2.2 mm gaps on the 4 × 6 in two-language card, as the PDF does', () => {
    const fit = previewImmersiveFit(
      frontOf(choice('counter_card', ['en', 'es'])),
      'card4x6',
      look(),
    )
    expect(fit).toMatchObject({ window: true, scale: 'two', gapPt: FIT.gapPt.immersive })
    expect(fit.wordmarkPt).toBe(16)
  })

  it('steps the A6 two-language card down to 2 mm gaps, the tight type and a 15 pt wordmark', () => {
    const fit = previewImmersiveFit(
      frontOf(choice('counter_card', ['en', 'bg'])),
      'cardA6',
      look(),
    )
    expect(fit).toMatchObject({ window: true, scale: 'twoTight', gapPt: FIT.gapPt.tight })
    expect(fit.wordmarkPt).toBe(15)
  })

  it('sets one language at its own scale with a window', () => {
    const fit = previewImmersiveFit(
      frontOf(choice('counter_card', ['en'], 'tell'), { en: 'Chair 3' }),
      'card4x6',
      look(),
    )
    expect(fit).toMatchObject({ window: true, scale: 'one', gapPt: FIT.gapPt.immersive })
  })

  it('keeps the tent panel’s 3 mm gaps and its window for one language, with the 11.6 mm logo', () => {
    const fit = previewImmersiveFit(
      frontOf(choice('table_tent', ['en'])),
      'tentPanel4x6',
      look('/logo.png'),
    )
    expect(fit).toMatchObject({ window: true, scale: 'one', gapPt: FIT.gapPt.tent })
    expect(fit.logoHeightPt).toBeCloseTo((11.6 * 72) / 25.4, 6)
  })

  it('gives a two-language tent panel no window (decision D4)', () => {
    const fit = previewImmersiveFit(
      frontOf(choice('table_tent', ['en', 'es'])),
      'tentPanelA6',
      look(),
    )
    expect(fit.window).toBe(false)
  })
})

describe('immersiveBackground', () => {
  it('paints the two washes at 0.30 over the field, as the board does', () => {
    const background = immersiveBackground(immersivePrintKitPalette('#EAD6A8', '#16130E'))
    expect(background).toMatch(
      /^radial-gradient\(72% 46% at 0% 100%, rgba\([\d, ]+0\.3\)/u,
    )
    expect(background).toContain('radial-gradient(64% 42% at 100% 56%')
    expect(background.endsWith(', #16130E')).toBe(true)
  })
})

describe('printKitPrintShopLabel', () => {
  it('names the size family and says the page is a print shop’s', () => {
    expect(printKitPrintShopLabel('counter_card', 'letter', { index: 1, count: 2 })).toBe(
      '4 × 6 in counter card for a print shop, with bleed and crop marks · page 2 of 2, back',
    )
    expect(printKitPrintShopLabel('table_tent', 'a4', { index: 0, count: 1 })).toBe(
      'A6 table tent for a print shop, 105 × 296 mm flat with bleed and crop marks',
    )
  })
})
