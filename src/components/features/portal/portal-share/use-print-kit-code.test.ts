// The sample the print preview draws when the live address is not in memory.
// It stands in for the short print address, whose symbol is version 3 (29
// modules), so the preview of a small card shows the density that card prints at.

import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { QR_QUIET_ZONE_MODULES, renderQrSvg } from './portal-qr'
import { PREVIEW_SAMPLE_ADDRESS, symbolModulesOfSvg } from './use-print-kit-code'

describe('the preview sample address', () => {
  it('draws a version 3 symbol at error correction M, 29 modules across', () => {
    const symbol = QRCode.create(PREVIEW_SAMPLE_ADDRESS, { errorCorrectionLevel: 'M' })
    expect(symbol.version).toBe(3)
    expect(symbol.modules.size).toBe(29)
  })

  it('opens nothing of ours', () => {
    expect(new URL(PREVIEW_SAMPLE_ADDRESS).hostname).toBe('example.com')
  })
})

describe('symbolModulesOfSvg', () => {
  it('reads the symbol’s modules from the view box, less the quiet zone on both sides', async () => {
    const svg = await renderQrSvg(PREVIEW_SAMPLE_ADDRESS, QR_QUIET_ZONE_MODULES)
    expect(symbolModulesOfSvg(svg)).toBe(29)
  })

  it('knows nothing of a picture with no view box', () => {
    expect(symbolModulesOfSvg('<svg/>')).toBeNull()
  })
})
