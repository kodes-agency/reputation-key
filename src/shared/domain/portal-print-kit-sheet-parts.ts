// Two parts of a sheet's page (`portal-print-kit-sheets.ts`) that the round-3
// office sheets added: how far each face bleeds, edge by edge, and the short
// note an office sheet carries. Pure and shared.

/** How far a face's art runs past each edge of its trim. */
export type PanelBleed = Readonly<{
  topPt: number
  rightPt: number
  bottomPt: number
  leftPt: number
}>

export const NO_BLEED: PanelBleed = { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }

/** The same bleed on every edge. */
export const bleedAround = (pt: number): PanelBleed => ({
  topPt: pt,
  rightPt: pt,
  bottomPt: pt,
  leftPt: pt,
})

/** A short line of print instructions on an office sheet, set in the box it is given. */
export type SheetNote = Readonly<{
  /** The text, wrapped to the box's width. */
  text: string
  sizePt: number
  /** The box the text fills, as it reads: turned, the lines run up the page from its bottom-left corner. */
  leftPt: number
  topPt: number
  widthPt: number
  heightPt: number
  /** Turned a quarter anticlockwise, to run up a side margin. */
  turned: boolean
}>

/** The black of an Immersive office sheet's crop marks: the boards' ink, one colour on any printer. */
export const OFFICE_CROP_COLOUR = '#121614'

/** The grey of a note on an office sheet, and the leading its lines are set at. */
export const SHEET_NOTE = { colour: '#5C5650', leading: 1.2 } as const
