// Portal context — makes the final print kit's PDF (final design spec, slice 3).
//
// The final kit lives beside today's (`portal-print-kit-renderer.port.ts`) and
// replaces none of it: only where PRINT_KIT_FINAL_ENABLED is on does the Share
// tab ask for it. This slice prints single pieces, one face per page; office
// sheets and the print-shop page come later. As with today's kit, nothing in
// the input is a URL: the logo is bytes already read from Portal media.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type {
  PrintFinalAddress,
  PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import type { PrintFinalCodeRefusal } from '#/shared/domain/portal-print-final-code'

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
  /** What the code encodes, and its shape: the tile depends on the symbol it makes. */
  qrAddress: string
  address: PrintFinalAddress
}>

/** What the renderer throws when the symbol would print too small for the piece: thrown before any page is drawn. */
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
