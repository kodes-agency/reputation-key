import { describe, expect, it } from 'vitest'
import { BRAND_FIT, TYPE_PT } from '#/shared/domain/portal-print-kit-layout'
import {
  LINING_FIGURES,
  previewKicker,
  previewWordmark,
  mmToContainerWidth,
} from './print-kit-art-layout'

describe('previewWordmark', () => {
  it('sets a short brand on one line at the full size', () => {
    expect(previewWordmark('Avela')).toEqual({ lines: ['AVELA'], size: TYPE_PT.wordmark })
  })

  it('shrinks a longer brand to fit one line, no smaller than the floor', () => {
    const fitted = previewWordmark('Grand Hotel Europe & Spa')
    expect(fitted.lines).toEqual(['GRAND HOTEL EUROPE & SPA'])
    expect(fitted.size).toBeLessThan(TYPE_PT.wordmark)
    expect(fitted.size).toBeGreaterThanOrEqual(BRAND_FIT.wordmark.minPt)
  })

  it('wraps a very long brand to two lines rather than clip it', () => {
    const fitted = previewWordmark('Kempinski Hotel Grand Arena Bansko')
    expect(fitted.lines).toHaveLength(2)
    expect(fitted.lines.join(' ')).toBe('KEMPINSKI HOTEL GRAND ARENA BANSKO')
  })
})

describe('previewWordmark and previewKicker draw only what the file prints', () => {
  it('leaves out what no guest font carries, so the preview does not show what the file drops', () => {
    expect(previewWordmark('Bar 🏊 Avela').lines).toEqual(['BAR AVELA'])
    expect(previewKicker('Pool 酒 Terrace', 1).lines).toEqual(['POOL TERRACE'])
  })

  it('draws nothing for a name no guest font can print at all, as the file does', () => {
    expect(previewWordmark('Αθήνα').lines).toEqual([])
    expect(previewKicker('ΑΘΗΝΑ', 1).lines).toEqual([])
  })
})

describe('previewKicker', () => {
  it('sets a short title on one line at its size', () => {
    expect(previewKicker('Pool & Terrace', 1)).toEqual({
      lines: ['POOL & TERRACE'],
      size: TYPE_PT.kicker,
    })
  })

  it('wraps a long title to two lines, as the PDF does', () => {
    const fitted = previewKicker(
      'Spa & Wellness Centre Reception Desk and Lobby, Ground Floor East Wing',
      1,
    )
    expect(fitted.lines.length).toBeLessThanOrEqual(BRAND_FIT.kicker.maxLines)
    expect(fitted.size).toBeLessThanOrEqual(TYPE_PT.kicker)
  })
})

describe('mmToContainerWidth', () => {
  it('turns millimetres on the page into container-width units', () => {
    expect(mmToContainerWidth(125, 125)).toBe('100cqw')
    expect(mmToContainerWidth(12.5, 125)).toBe('10cqw')
  })
})

describe('LINING_FIGURES', () => {
  it('switches on the lnum feature, as the file does for the display face', () => {
    expect(LINING_FIGURES).toEqual({ fontFeatureSettings: '"lnum" 1' })
  })
})
