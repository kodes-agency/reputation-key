// Draws Paper or Immersive pieces, office sheets, print-shop files and optional
// card backs. Pictures arrive as stored bytes; the renderer fetches no URLs.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintAddress, PrintFace } from '#/shared/domain/portal-print'
import type { PrintCodeRefusal } from '#/shared/domain/portal-print-code'
import type { PrintFramings } from '#/shared/domain/portal-print-framing'
import type { PrintKitPhoto } from '../../printing/contracts'

/**
 * Office sheets: how many pieces the manager needs, whether the last sheet's
 * spare cells print too, and how many go on a sheet when the manager asks for
 * fewer than fit (absent: every cell).
 */
export type PrintSheetsInput = Readonly<{
  quantity: number
  fillSpares: boolean
  perSheet?: number
}>

/**
 * A print shop's file: one piece per page, the trim plus the bleed all round.
 * Crop marks are off unless asked for; on, the page grows to hold them.
 */
export type PrintShopInput = Readonly<{
  cropMarks: boolean
}>

export type PrintRenderInput = Readonly<{
  /** The document's title, shown by a PDF viewer. */
  personalName?: string
  title: string
  /** Which piece, which way up, which look and which measure set. */
  face: PrintFace
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
  framings?: PrintFramings
  /** What the code encodes, and its shape: the tile depends on the symbol it makes. */
  qrAddress: string
  address: PrintAddress
  /** Present: the pieces go on office sheets, exactly as many as asked for. Absent: one piece per page. */
  sheets?: PrintSheetsInput
  /** Present: a print shop's file, one card per page with its bleed (cards only; a tent is refused). Not with `sheets`. */
  shop?: PrintShopInput
  /**
   * Present: the optional back page prints too (cards only), the property's name
   * under the logo. After a lone piece's page comes its back; after each sheet
   * comes the sheet's back, its cells mirrored so the backs lie behind the fronts.
   */
  back?: Readonly<{ propertyName: string }>
}>

/** What the renderer throws when the symbol would print too small for the piece, two cues would not fit the bar, or the words do not fit the face at the smallest headline: thrown before any page is drawn. */
export class PrintRenderRefusal extends Error {
  readonly refusal: PrintCodeRefusal

  constructor(refusal: PrintCodeRefusal) {
    super(`The print was refused: ${refusal.code}`)
    this.name = 'PrintRenderRefusal'
    this.refusal = refusal
  }
}

export type PortalPrintRenderer = Readonly<{
  render: (input: PrintRenderInput) => Promise<Uint8Array>
}>
