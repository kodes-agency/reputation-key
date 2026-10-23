// The code tile per size, and the rule that picks it (round-3 spec-delta S1, S2).
//
// The tile is the cream square with the symbol and its four-module quiet zone;
// the bar joined under it carries the cue. Every size has its own tile, because
// the code is what decides how big a piece must be, and a smaller piece needs a
// smaller code: Large 1.75 in, Table and the small tent 1.4 in (36 mm in Europe),
// Mini 1.25 in (32 mm). Whether a tile may carry a given address is one measure,
// the module (the side of one dark square on paper): never under 0.85 mm, which
// is within 5 % of what ships today (0.891 mm) and lets Mini at 1.25 in through
// by 1 % with a version 3 symbol. The camera, not the vendor rule, is the real
// test: Gate 2 prints each piece and scans it.
//
// Pure and shared. The PDF and the Share tab's preview both ask `chooseCodeTile`,
// so the preview cannot show a tile the file would refuse. Nothing draws from this
// yet: the faces still use today's 2 in `CODE_BLOCK`, which is also the tile Large
// falls back to.

import { err, ok, type Result } from './result'
import {
  PRINT_KIT_QR_QUIET_ZONE_MODULES,
  type PrintKitPaper,
  type PrintKitSize,
} from './portal-print-kit'
import {
  CODE_BLOCK,
  inToPt,
  mmToPt,
  ptToMm,
  type CueLines,
} from './portal-print-kit-measures'

/** The least a module may measure on paper, in millimetres. */
export const CODE_MODULE_MIN_MM = 0.85

/** One tile and its bar: everything a code block draws from, by cue lines where it differs. */
export type CodeTile = Readonly<{
  /** The tile is square, and the bar under it is exactly as wide. */
  tilePt: number
  barPt: Readonly<Record<CueLines, number>>
  cuePt: Readonly<Record<CueLines, number>>
  /** The camera pictogram's box; null when the tile is too small to give it a slot. */
  pictogramPt: Readonly<Record<CueLines, number>> | null
  /** Left and right padding of the bar. */
  barPaddingPt: number
  /** Between the pictogram and the cue. */
  iconGapPt: number
  /** The corner radius of the whole object: 5 % of the tile. */
  radiusPt: number
}>

/** The 2 in block every card prints on today (`CODE_BLOCK`), which Large falls back to. */
export const TODAY_CODE_TILE: CodeTile = {
  tilePt: CODE_BLOCK.tilePt,
  barPt: CODE_BLOCK.barPt,
  cuePt: CODE_BLOCK.cuePt,
  pictogramPt: CODE_BLOCK.iconPt,
  barPaddingPt: CODE_BLOCK.barPaddingPt,
  iconGapPt: CODE_BLOCK.iconGapPt,
  radiusPt: CODE_BLOCK.radiusPt,
}

const ICON_GAP_PT = inToPt(0.06)
const RADIUS_SHARE = 0.05

type TileDesign = Readonly<{
  /** The bar's height in inches, one cue line and two. */
  barIn: Readonly<Record<CueLines, number>>
  cuePt: number
  /** The pictogram's box in inches, or null for none. */
  pictogramIn: number | null
  paddingIn: number
}>

function tileOf(tilePt: number, design: TileDesign): CodeTile {
  return {
    tilePt,
    barPt: { one: inToPt(design.barIn.one), two: inToPt(design.barIn.two) },
    cuePt: { one: design.cuePt, two: design.cuePt },
    pictogramPt:
      design.pictogramIn === null
        ? null
        : { one: inToPt(design.pictogramIn), two: inToPt(design.pictogramIn) },
    barPaddingPt: inToPt(design.paddingIn),
    iconGapPt: ICON_GAP_PT,
    radiusPt: tilePt * RADIUS_SHARE,
  }
}

// The pictogram stays only from 1.75 in up, so the cue keeps one line at 9 pt
// (8 pt on Mini, the one place a guest reads under 9 pt).
const LARGE: TileDesign = {
  barIn: { one: 0.36, two: 0.46 },
  cuePt: 9,
  pictogramIn: 0.15,
  paddingIn: 0.08,
}
const TABLE: TileDesign = {
  barIn: { one: 0.3, two: 0.38 },
  cuePt: 9,
  pictogramIn: null,
  paddingIn: 0.03,
}
const MINI: TileDesign = {
  barIn: { one: 0.27, two: 0.38 },
  cuePt: 8,
  pictogramIn: null,
  paddingIn: 0.03,
}

/** The tile of each size on each paper: inches on Letter, millimetres on A4 where the spec says so. */
export const CODE_TILE: Readonly<
  Record<PrintKitSize, Readonly<Record<PrintKitPaper, CodeTile>>>
> = {
  large: {
    letter: tileOf(inToPt(1.75), LARGE),
    a4: tileOf(inToPt(1.75), LARGE),
  },
  table: {
    letter: tileOf(inToPt(1.4), TABLE),
    a4: tileOf(mmToPt(36), TABLE),
  },
  mini: {
    letter: tileOf(inToPt(1.25), MINI),
    a4: tileOf(mmToPt(32), MINI),
  },
}

/** The tile and the bar together, for `lines` cue lines. */
export const codeTileHeightPt = (tile: CodeTile, lines: CueLines): number =>
  tile.tilePt + tile.barPt[lines]

/** The room for one cue line in the bar: the tile less the padding and the pictogram's slot. */
export function codeTileCueRoomPt(tile: CodeTile, lines: CueLines): number {
  const slot = tile.pictogramPt === null ? 0 : tile.pictogramPt[lines] + tile.iconGapPt
  return tile.tilePt - 2 * tile.barPaddingPt - slot
}

/** One module on paper, in millimetres: the tile over the symbol and its quiet zone. */
export function codeModuleMm(tilePt: number, symbolModules: number): number {
  return ptToMm(tilePt) / (symbolModules + 2 * PRINT_KIT_QR_QUIET_ZONE_MODULES)
}

/**
 * What the address is: a long address (the whole token and the access-artifact
 * marker: 147 characters on the fixture host, 159 on the beta) or a short print
 * address (the print host and a print code). It decides which way a refusal reads.
 */
export type PrintAddressShape = 'long' | 'short'

/**
 * A size refused because its code would be printed too small to scan. The cause
 * says what the manager can do: `needs_short_code` (this code has no print code:
 * replace it), or `address_host_too_long` (it has one, but the print host is too
 * long for the symbol to stay as small as this tile needs: nothing to replace).
 */
export type PrintCodeTooSmall = Readonly<{
  code: 'print_code_too_small'
  cause: 'needs_short_code' | 'address_host_too_long'
  size: PrintKitSize
  /** What the module would have measured, in millimetres. */
  moduleMm: number
}>

export type CodeTileChoice = Readonly<{
  tile: CodeTile
  /** The module on paper in this tile, in millimetres. */
  moduleMm: number
}>

type CodeTileQuery = Readonly<{
  size: PrintKitSize
  paper: PrintKitPaper
  /** Modules along one side of the symbol, the quiet zone not included. */
  symbolModules: number
  addressShape: PrintAddressShape
}>

/**
 * The tile a piece prints its code on. Large takes its 1.75 in tile when the
 * module there reaches the floor, and otherwise today's 2 in tile, exactly as
 * every card prints now: Large is never refused, because today's beta address
 * (version 9, 0.833 mm at 2 in) must keep printing. Table and Mini have no
 * larger tile to fall back to, so they refuse.
 */
export function chooseCodeTile(
  query: CodeTileQuery,
): Result<CodeTileChoice, PrintCodeTooSmall> {
  const { size, paper, symbolModules, addressShape } = query
  const tile = CODE_TILE[size][paper]
  const moduleMm = codeModuleMm(tile.tilePt, symbolModules)
  if (moduleMm >= CODE_MODULE_MIN_MM) return ok({ tile, moduleMm })
  if (size === 'large') {
    return ok({
      tile: TODAY_CODE_TILE,
      moduleMm: codeModuleMm(TODAY_CODE_TILE.tilePt, symbolModules),
    })
  }
  const cause = addressShape === 'long' ? 'needs_short_code' : 'address_host_too_long'
  return err({ code: 'print_code_too_small', cause, size, moduleMm })
}
