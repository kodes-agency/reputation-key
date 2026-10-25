// Portal context — makes the final print kit's PDF (final design spec, slice 3).
//
// The final kit lives beside today's (`portal-print-kit-renderer.port.ts`) and
// replaces none of it: only where PRINT_KIT_FINAL_ENABLED is on does the Share
// tab ask for it. It prints single pieces so far, one face per page, in Paper
// or Immersive; office sheets and the print-shop page come later. As with
// today's kit, nothing in the input is a URL: the logo and the photo are bytes
// already read from Portal media.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type {
  PrintFinalAddress,
  PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import type { PrintFinalCodeRefusal } from '#/shared/domain/portal-print-final-code'
import type { PrintFinalFramings } from '#/shared/domain/portal-print-final-framing'
import type { PrintKitPhoto } from './portal-print-kit-renderer.port'

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
}>

/** What the renderer throws when the symbol would print too small for the piece, or two cues would not fit the bar: thrown before any page is drawn. */
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
