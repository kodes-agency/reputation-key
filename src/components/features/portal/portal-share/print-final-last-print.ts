// What the Last printed notice says (final design spec §11, the boards
// share-desktop-light, share-desktop-dark and share-phone): when the Portal was
// last printed and what the print was, and, for an Immersive print, what became
// of the photo since. Copy only, in one place, so each line is tested as written.

import type { PortalPrintKitLastPrint } from '#/contexts/portal/application/public-api'
import { formatShortDate, type DisplayZone, type InstantInput } from '#/lib/format'
import { PRINT_FINAL_PAPER_NAMES } from '#/shared/domain/portal-print-final-share'
import { printFinalLanguageNames } from '#/shared/domain/portal-print-final-how-to'
import type { PrintFinalLastSettings } from '#/shared/domain/portal-print-final-last'
import type { PrintFinalLook, PrintFinalPiece } from '#/shared/domain/portal-print-final'

/** The notice: its bold line, and the line under it when the photo has something to say. */
export type PrintFinalLastNotice = Readonly<{
  title: string
  photoLine: string | null
}>

/** The pieces as a sentence names them: one and many. */
const PIECE_NAMES: Readonly<Record<PrintFinalPiece, readonly [string, string]>> =
  Object.freeze({
    tent: ['table tent', 'table tents'],
    counter: ['Counter card', 'Counter cards'],
    small: ['Small card', 'Small cards'],
  })

const LOOK_NAMES: Readonly<Record<PrintFinalLook, string>> = Object.freeze({
  paper: 'Paper',
  immersive: 'Immersive',
})

/**
 * "10 Paper table tents, wide, on Letter, English + Español". A second language is
 * named, a lone one is not; a print of the manager's own words ends
 * " · your own words" (§11.5). A print shop's file is one piece a page, so it names
 * no count.
 */
function summaryOf(settings: PrintFinalLastSettings): string {
  const [one, many] = PIECE_NAMES[settings.piece]
  const look = LOOK_NAMES[settings.look]
  const what =
    settings.printer === 'print_shop'
      ? `${look} ${one} for a print shop`
      : `${settings.quantity} ${look} ${settings.quantity === 1 ? one : many}`
  const languages =
    settings.languages.length > 1 ? [printFinalLanguageNames(settings.languages)] : []
  const words = settings.customWords === null ? '' : ' · your own words'
  return `${[what, settings.orientation, `on ${PRINT_FINAL_PAPER_NAMES[settings.paper]}`, ...languages].join(', ')}${words}`
}

/** What the photo's change says; null for a photo that did not change. */
function photoLineOf(
  change: PortalPrintKitLastPrint['photo'],
  dateOf: (instant: InstantInput) => string,
): string | null {
  if (change.kind === 'same') return null
  if (change.kind === 'removed') {
    return 'Your photo was removed since. Printing again prints without it.'
  }
  const when = change.on === null ? 'since' : `on ${dateOf(change.on)}`
  return `Your photo changed ${when}. Printing again uses the new one.`
}

/**
 * The notice for a Portal's last print. Days are read in `zone`, the manager's own
 * by default (the notice exists only in the browser, after the read), and a day in
 * an earlier year names it.
 */
export function printFinalLastNotice(
  last: PortalPrintKitLastPrint,
  now: InstantInput,
  zone: DisplayZone = 'viewer',
): PrintFinalLastNotice {
  const dateOf = (instant: InstantInput) =>
    formatShortDate(instant, zone, now) ?? 'an earlier day'
  return {
    title: `Last printed ${dateOf(last.printedAt)} · ${summaryOf(last.settings)}`,
    photoLine: photoLineOf(last.photo, dateOf),
  }
}
