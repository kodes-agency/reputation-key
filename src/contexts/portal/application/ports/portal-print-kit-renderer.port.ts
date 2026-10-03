// Portal context — makes the print kit's PDF.
//
// The use case decides what the print says and which pictures it carries; the
// adapter only draws it. Nothing in the input is a URL: the pictures are bytes
// already read from Portal media, so the renderer never fetches anything.

import type { PrintFace, PrintKitPiece } from '#/shared/domain/portal-print-kit'

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
  faces: readonly PrintFace[]
  /** The brand set as text when there is no logo. */
  wordmark: string
  logo: Uint8Array | null
  photo: PrintKitPhoto | null
  accentColour: string
  fieldColour: string
  /** What the code encodes: the QR address, with its access-artifact marker. */
  qrAddress: string
  /** What is printed under the code as words. */
  shortAddress: string
}>

export type PortalPrintKitRenderer = Readonly<{
  render: (input: PrintKitRenderInput) => Promise<Uint8Array>
}>
