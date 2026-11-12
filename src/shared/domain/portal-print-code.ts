// The print's code block (design spec §2.1, §5.2 and §9): the cream
// tile a piece prints its code on, the bar joined under it with the scan cue,
// and the refusals when a symbol would print too small to scan.
//
// The tile holds the symbol and its four-module quiet zone, so a module is the
// tile over the symbol's modules plus eight. No module goes under 0.85 mm: on
// the short address (version 3, 37 modules) every piece passes; on the
// lower-case fallback (version 4, 41 modules) the Small card does not; on
// today's long address (version 9, 61 modules) only the Counter card prints,
// on a 2.1 in tile.

import { err, ok, type Result } from './result'
import { PRINT_KIT_QR_QUIET_ZONE_MODULES } from './portal-print-kit'
import type {
  PrintAddress,
  PrintFace,
  PrintOrientation,
  PrintPiece,
  PrintRegion,
} from './portal-print'
import {
  PRINT_DISTANCES,
  PRINT_LONG_ADDRESS_COUNTER,
  PRINT_MEASURES,
  PRINT_TILE_STEP_UP_PT,
  printOutlinePt,
  ptMm,
  type PrintBars,
  type PrintTileRung,
} from './portal-print-measures'

/** The least a module may measure on paper, in millimetres. */
export const PRINT_MODULE_MIN_MM = 0.85

/** The module on paper, in millimetres, for a tile of `tilePt` and a symbol of `symbolModules` (quiet zone not included). */
export const printModuleMm = (tilePt: number, symbolModules: number): number =>
  ptMm(tilePt) / (symbolModules + 2 * PRINT_KIT_QR_QUIET_ZONE_MODULES)

export type PrintCodeRefusal = Readonly<{
  code:
    | 'needs_short_code'
    | 'address_host_too_long'
    | 'tile_does_not_fit'
    | 'cue_does_not_fit'
    | 'words_do_not_fit'
  /** What the module would have measured, in millimetres; null when the module is not the reason. */
  moduleMm: number | null
}>

export type PrintTile = Readonly<{
  tilePt: number
  bars: PrintBars
  moduleMm: number
}>

export type PrintTileQuery = Readonly<{
  piece: PrintPiece
  orientation: PrintOrientation
  region: PrintRegion
  address: PrintAddress
  /** Modules along one side of the symbol, the quiet zone not included (version 3 is 29). */
  symbolModules: number
  rung?: PrintTileRung
}>

/**
 * The tile a face prints its code on, or why it cannot print. On the long
 * address everything but the Counter card is refused (`needs_short_code`: mint
 * a print code), and the Counter card takes its 2.1 in tile. Otherwise the
 * piece's tile (or its step-up rung) must keep the module at 0.85 mm or more; a
 * short address that cannot is `address_host_too_long`. The wide Small card has
 * no room for the step-up tile (`tile_does_not_fit`).
 */
export function choosePrintTile(
  query: PrintTileQuery,
): Result<PrintTile, PrintCodeRefusal> {
  const measures = PRINT_MEASURES[query.region][query.piece]
  if (query.address === 'long') {
    if (query.piece !== 'counter')
      return err({ code: 'needs_short_code', moduleMm: null })
    const tile = PRINT_LONG_ADDRESS_COUNTER
    const moduleMm = printModuleMm(tile.tilePt, query.symbolModules)
    return moduleMm >= PRINT_MODULE_MIN_MM
      ? ok({ tilePt: tile.tilePt, bars: tile.bars, moduleMm })
      : err({ code: 'needs_short_code', moduleMm })
  }
  const stepUp = query.rung === 'step_up'
  if (stepUp && query.piece === 'small' && query.orientation === 'wide') {
    return err({ code: 'tile_does_not_fit', moduleMm: null })
  }
  const tilePt = stepUp ? PRINT_TILE_STEP_UP_PT[query.piece] : measures.tilePt
  const moduleMm = printModuleMm(tilePt, query.symbolModules)
  return moduleMm >= PRINT_MODULE_MIN_MM
    ? ok({ tilePt, bars: measures.bars, moduleMm })
    : err({ code: 'address_host_too_long', moduleMm })
}

// ---------------------------------------------------------------------------
// The block

export type PrintCodeBlock = Readonly<{
  /** The cream square. */
  tilePt: number
  barPt: number
  /** The Paper outline outside the square and the bar; 0 on Immersive. */
  outlinePt: number
  /** The whole block as the planner places it: the outline included. */
  widthPt: number
  heightPt: number
  /** The outer corner radius: 5 % of the tile, plus the outline. */
  radiusPt: number
}>

/** The code block a face draws: the tile, the bar for its cue lines, and the Paper outline round both. */
export function printCodeBlock(
  face: Pick<PrintFace, 'look'>,
  tile: Pick<PrintTile, 'tilePt' | 'bars'>,
  cueLineCount: number,
): PrintCodeBlock {
  const outlinePt = printOutlinePt(face.look)
  const barPt = cueLineCount > 1 ? tile.bars.twoPt : tile.bars.onePt
  return {
    tilePt: tile.tilePt,
    barPt,
    outlinePt,
    widthPt: tile.tilePt + 2 * outlinePt,
    heightPt: tile.tilePt + barPt + 2 * outlinePt,
    radiusPt: tile.tilePt * PRINT_DISTANCES.tileRadiusShare + outlinePt,
  }
}
