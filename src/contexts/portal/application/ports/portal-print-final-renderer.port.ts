// Portal context — makes the final print kit's PDF (final design spec, slices 3
// to 6 and 11).
//
// The final kit lives beside today's (`portal-print-kit-renderer.port.ts`) and
// replaces none of it: only where PRINT_KIT_FINAL_ENABLED is on does the Share
// tab ask for it. It prints single pieces, one face per page, in Paper or
// Immersive, office sheets (several pieces to a sheet, each Immersive piece
// with its own bleed and crop marks) when `sheets` is given, a print shop's file
// (one card per page with its bleed, its trim and bleed boxes and optional crop
// marks) when `shop` is given, and a card's optional back page after its front.
// As with today's kit, nothing in the input is a URL: the logo and the photo are
// bytes already read from Portal media.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type {
  PrintFinalAddress,
  PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import type { PrintFinalCodeRefusal } from '#/shared/domain/portal-print-final-code'
import type { PrintFinalFramings } from '#/shared/domain/portal-print-final-framing'
import type { PrintKitPhoto } from './portal-print-kit-renderer.port'

/**
 * Office sheets: how many pieces the manager needs, whether the last sheet's
 * spare cells print too, and how many go on a sheet when the manager asks for
 * fewer than fit (absent: every cell).
 */
export type PrintFinalSheetsInput = Readonly<{
  quantity: number
  fillSpares: boolean
  perSheet?: number
}>

/**
 * A print shop's file: one piece per page, the trim plus the bleed all round.
 * Crop marks are off unless asked for; on, the page grows to hold them.
 */
export type PrintFinalShopInput = Readonly<{
  cropMarks: boolean
}>

export type PrintFinalRenderInput = Readonly<{
  /** The document's title, shown by a PDF viewer. */
  title: string
  /** Which piece, which way up, which look and which measure set. */
  face: PrintFinalFace
  /** One language, or two, the first leading. */
  blocks: readonly PrintTextBlock[]
  /** The brand set as text when there is no logo. */
  wordmark: string
  logo: Uint8Array | null
  accentColour: string
  /** The property's field: Immersive mixes the photo's colour into it for the ground, and paints it with no photo. */
  fieldColour: string
  /** The photo an Immersive face fades from; null for the no-photo ground. Paper ignores it. */
  photo: PrintKitPhoto | null
  /** How the manager moved and zoomed the photo, per piece and orientation; the plain cover crop where none is stored. */
  framings?: PrintFinalFramings
  /** What the code encodes, and its shape: the tile depends on the symbol it makes. */
  qrAddress: string
  address: PrintFinalAddress
  /** Present: the pieces go on office sheets, exactly as many as asked for. Absent: one piece per page. */
  sheets?: PrintFinalSheetsInput
  /** Present: a print shop's file, one card per page with its bleed (cards only; a tent is refused). Not with `sheets`. */
  shop?: PrintFinalShopInput
  /**
   * Present: the optional back page prints too (cards only), the property's name
   * under the logo. After a lone piece's page comes its back; after each sheet
   * comes the sheet's back, its cells mirrored so the backs lie behind the fronts.
   */
  back?: Readonly<{ propertyName: string }>
}>

/** What the renderer throws when the symbol would print too small for the piece, two cues would not fit the bar, or the words do not fit the face at the smallest headline: thrown before any page is drawn. */
export class PrintFinalRenderRefusal extends Error {
  readonly refusal: PrintFinalCodeRefusal

  constructor(refusal: PrintFinalCodeRefusal) {
    super(`The final print was refused: ${refusal.code}`)
    this.name = 'PrintFinalRenderRefusal'
    this.refusal = refusal
  }
}

export type PortalPrintFinalRenderer = Readonly<{
  render: (input: PrintFinalRenderInput) => Promise<Uint8Array>
}>
