import { describe, expect, it } from 'vitest'
import {
  PLATE_ABOVE_ADDRESS_MM,
  PLATE_MM,
  PANEL_HEIGHT_MM,
  BOTTOM_MARGIN_MM,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'
import {
  previewAddress,
  previewPlateTopMm,
  mmToContainerWidth,
} from './print-kit-art-layout'

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
