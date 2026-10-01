// The portal's code as vector geometry. The PDF draws rectangles, never a
// raster: a print shop can scale it to any size without a soft edge.
//
// The symbol comes from the same `qrcode` library the Share tab's PNG and SVG
// use, at the same error correction, so the printed code and the downloaded
// image are one symbol.

import QRCode from 'qrcode'
import { PRINT_KIT_QR_QUIET_ZONE_MODULES } from '#/shared/domain/portal-print-kit'

export type QrMatrix = Readonly<{
  /** Modules along one side, the quiet zone not included. */
  size: number
  isDark: (row: number, column: number) => boolean
}>

export function qrMatrix(address: string): QrMatrix {
  const { modules } = QRCode.create(address, { errorCorrectionLevel: 'M' })
  return {
    size: modules.size,
    isDark: (row, column) => modules.get(row, column) === 1,
  }
}

export type QrRun = Readonly<{ row: number; column: number; length: number }>

/** The dark modules as horizontal runs: one rectangle each, not one per module. */
export function qrDarkRuns(matrix: QrMatrix): readonly QrRun[] {
  const runs: QrRun[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    let start: number | null = null
    for (let column = 0; column <= matrix.size; column += 1) {
      const dark = column < matrix.size && matrix.isDark(row, column)
      if (dark && start === null) start = column
      if (!dark && start !== null) {
        runs.push({ row, column: start, length: column - start })
        start = null
      }
    }
  }
  return runs
}

/** Modules along one side of the light plate: the symbol and its quiet zone. */
export function qrPlateModules(symbolModules: number): number {
  return symbolModules + 2 * PRINT_KIT_QR_QUIET_ZONE_MODULES
}
