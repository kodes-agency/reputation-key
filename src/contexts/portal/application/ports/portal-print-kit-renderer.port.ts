// Portal context — makes the print kit's PDF.
//
// The use case decides what the print says and which pictures it carries; the
// adapter only draws it. Nothing in the input is a URL: the pictures are bytes
// already read from Portal media, so the renderer never fetches anything.

import type {
  PrintFace,
  PrintKitOutput,
  PrintKitPaper,
  PrintKitPiece,
  PrintKitSize,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import type { PrintCodeTooSmall } from '#/shared/domain/portal-print-kit-code-tile'

export type PrintKitPhoto = Readonly<{
  /** The stored image, as the media store holds it. */
  bytes: Uint8Array
  focalX: number
  focalY: number
}>

export type PrintKitRenderInput = Readonly<{
  /** The document's title, shown by a PDF viewer. */
  title: string
  piece: PrintKitPiece
  /**
   * The look, and the paper it prints on (spec 6): the paper sets the sheet and
   * the size of every face, and for Immersive names the size family.
   */
  style: PrintKitStyle
  paper: PrintKitPaper
  /** The piece's size (round 3): the old tent is the `table_tent` at size Large. */
  size: PrintKitSize
  /** Who prints it: a print shop, from one piece per page, or an office printer, from a sheet. */
  output: PrintKitOutput
  faces: readonly PrintFace[]
  /** The brand set as text when there is no logo. */
  wordmark: string
  /** The Property's name, printed under a logo on a card (round-2 R2); null when the manager turned the line off. */
  propertyName: string | null
  logo: Uint8Array | null
  photo: PrintKitPhoto | null
  accentColour: string
  fieldColour: string
  /** What the code encodes: the QR address, with its access-artifact marker. */
  qrAddress: string
}>

/**
 * What the renderer refuses to print. A photo that would print soft is not one:
 * it is reported and printed, and the manager is told before the file is made.
 */
export type PrintKitRefusal = PrintCodeTooSmall

/**
 * What the renderer throws when the print it was asked for would not scan: the
 * use case turns it into a refusal the manager reads. Thrown before any page is
 * drawn.
 */
export class PrintKitRenderRefusal extends Error {
  readonly refusal: PrintKitRefusal

  constructor(refusal: PrintKitRefusal) {
    super(`The print kit was refused: ${refusal.code}`)
    this.name = 'PrintKitRenderRefusal'
    this.refusal = refusal
  }
}

export type PortalPrintKitRenderer = Readonly<{
  render: (input: PrintKitRenderInput) => Promise<Uint8Array>
}>
