import { describe, expect, it } from 'vitest'
import {
  PLATE_ABOVE_ADDRESS_MM,
  PLATE_MM,
  PANEL_HEIGHT_MM,
  BOTTOM_MARGIN_MM,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'
import { BRAND_FIT } from '#/shared/domain/portal-print-kit-layout'
import {
  previewAddress,
  previewKicker,
  previewPlateTopMm,
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

describe('previewAddress', () => {
  it('sets a short address on one line at the full size', () => {
    const address = previewAddress('app.example.com/p/abc')
    expect(address.lines).toEqual(['app.example.com/p/abc'])
    expect(address.sizePt).toBe(TYPE_PT.address)
  })

  it('shrinks a long address to fit one line, down to the smallest size', () => {
    const address = previewAddress(`app.example.com/p/pt_${'x'.repeat(60)}`)
    expect(address.lines).toHaveLength(1)
    expect(address.sizePt).toBeLessThan(TYPE_PT.address)
    expect(address.sizePt).toBeGreaterThanOrEqual(TYPE_PT.addressMin)
  })

  it('breaks an address that cannot fit at the smallest size, before the token', () => {
    const address = previewAddress(`a-very-long-host.example.com/p/pt_${'x'.repeat(120)}`)
    expect(address.lines).toEqual([
      'a-very-long-host.example.com/p/',
      `pt_${'x'.repeat(120)}`,
    ])
  })
})

describe('previewPlateTopMm', () => {
  it('sits the plate above the address, which sits above the bottom margin', () => {
    const address = previewAddress('app.example.com/p/abc')
    expect(previewPlateTopMm(address)).toBeCloseTo(
      PANEL_HEIGHT_MM -
        BOTTOM_MARGIN_MM -
        address.heightMm -
        PLATE_ABOVE_ADDRESS_MM -
        PLATE_MM,
      6,
    )
  })

  it('moves the plate up for a two-line address', () => {
    const one = previewPlateTopMm(previewAddress('app.example.com/p/abc'))
    const two = previewPlateTopMm(
      previewAddress(`a-very-long-host.example.com/p/pt_${'x'.repeat(120)}`),
    )
    expect(two).toBeLessThan(one)
  })
})

describe('mmToContainerWidth', () => {
  it('turns millimetres on the page into container-width units', () => {
    expect(mmToContainerWidth(125, 125)).toBe('100cqw')
    expect(mmToContainerWidth(12.5, 125)).toBe('10cqw')
  })
})
