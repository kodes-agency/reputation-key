import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { PRINT_KIT_QR_QUIET_ZONE_MODULES } from '#/shared/domain/portal-print-kit'
import { qrDarkRuns, qrMatrix, qrPlateModules } from './print-kit-qr'

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'

describe('qrMatrix', () => {
  it('encodes the address as the qrcode library does', () => {
    const matrix = qrMatrix(ADDRESS)
    const reference = QRCode.create(ADDRESS, { errorCorrectionLevel: 'M' })
    expect(matrix.size).toBe(reference.modules.size)
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        expect(matrix.isDark(row, column)).toBe(reference.modules.get(row, column) === 1)
      }
    }
  })
})

describe('qrDarkRuns', () => {
  it('covers exactly the dark modules, row by row, with no run crossing a light one', () => {
    const matrix = qrMatrix(ADDRESS)
    const painted = Array.from({ length: matrix.size }, () =>
      Array.from({ length: matrix.size }, () => false),
    )
    for (const run of qrDarkRuns(matrix)) {
      expect(run.length).toBeGreaterThan(0)
      for (let offset = 0; offset < run.length; offset += 1) {
        const cell = painted[run.row]
        expect(cell?.[run.column + offset]).toBe(false)
        if (cell) cell[run.column + offset] = true
      }
    }
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        expect(painted[row]?.[column]).toBe(matrix.isDark(row, column))
      }
    }
  })

  it('merges neighbours, so a code takes far fewer rectangles than modules', () => {
    const matrix = qrMatrix(ADDRESS)
    expect(qrDarkRuns(matrix).length).toBeLessThan((matrix.size * matrix.size) / 3)
  })
})

describe('qrPlateModules', () => {
  it('is the symbol plus a four-module quiet zone on every side', () => {
    expect(PRINT_KIT_QR_QUIET_ZONE_MODULES).toBe(4)
    expect(qrPlateModules(29)).toBe(37)
  })
})
