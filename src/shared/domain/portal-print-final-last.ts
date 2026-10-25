// What the final print kit remembers of a Portal's last print (final design spec
// §11 "Last printed", build slice 12): the choices the manager made, so Share can
// say what was printed and when, and set the same choices again; and the photo the
// print used, so it can say when the photo has changed since. Never the address or
// the code: a print's choices are the only thing kept. Pure and shared, like the
// kit's other vocabulary: the server decides what changed, Share words it.

import type { GuestLocale } from './guest-locale'
import type {
  PrintFinalLook,
  PrintFinalOrientation,
  PrintFinalPiece,
  PrintFinalPrinter,
} from './portal-print-final'
import type { PrintKitPaper } from './portal-print-kit'
import type { PrintFinalCallToAction } from './portal-print-final-copy'

/**
 * The choices of a print, as the download took them: what "Use the same
 * settings" puts back. A print shop's file ignores the quantity, the spares and
 * the count a sheet, but they are kept as the manager had them, so the form comes
 * back as it was.
 */
export type PrintFinalLastSettings = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  /** The paper the file was made for, whether the manager named it or the country decided. */
  paper: PrintKitPaper
  printer: PrintFinalPrinter
  quantity: number
  fillSpares: boolean
  /** Null: every cell of the sheet. */
  perSheet: number | null
  cropMarks: boolean
  backPage: boolean
  languages: readonly GuestLocale[]
  /** The wording the print said, or started from when the manager wrote their own words. */
  callToAction: PrintFinalCallToAction
}>

/** The photo an Immersive print was made from: which image, and how it was framed. */
export type PrintFinalLastPhoto = Readonly<{
  assetId: string
  focalX: number
  focalY: number
}>

/**
 * What became of the photo since the last print. `on` is when the photo that
 * prints now was added, when that was after the print: a photo chosen from the
 * Property's earlier uploads, or a photo only reframed, has no such day.
 */
export type PrintFinalPhotoChange =
  | Readonly<{ kind: 'same' }>
  | Readonly<{ kind: 'changed'; on: string | null }>
  | Readonly<{ kind: 'removed' }>

/** Two framings of one photo that differ by less than this are the same framing. */
const FOCAL_TOLERANCE = 1e-6

const isSamePhoto = (left: PrintFinalLastPhoto, right: PrintFinalLastPhoto): boolean =>
  left.assetId === right.assetId &&
  Math.abs(left.focalX - right.focalX) < FOCAL_TOLERANCE &&
  Math.abs(left.focalY - right.focalY) < FOCAL_TOLERANCE

/**
 * Whether the photo a print would use now is the one the last print used. A Paper
 * print carries no photo, so nothing can have changed for it. `addedAt` is when
 * the image that prints now was uploaded to the Property.
 */
export function printFinalPhotoChange(
  input: Readonly<{
    last: Readonly<{
      look: PrintFinalLook
      photo: PrintFinalLastPhoto | null
      printedAt: Date
    }>
    current: Readonly<{ photo: PrintFinalLastPhoto | null; addedAt: Date | null }>
  }>,
): PrintFinalPhotoChange {
  const { last, current } = input
  if (last.look !== 'immersive') return { kind: 'same' }
  if (current.photo === null) {
    return last.photo === null ? { kind: 'same' } : { kind: 'removed' }
  }
  if (last.photo !== null && isSamePhoto(last.photo, current.photo)) {
    return { kind: 'same' }
  }
  const isNewImage = last.photo === null || last.photo.assetId !== current.photo.assetId
  const added = current.addedAt
  const on =
    isNewImage && added !== null && added.getTime() > last.printedAt.getTime()
      ? added.toISOString()
      : null
  return { kind: 'changed', on }
}
