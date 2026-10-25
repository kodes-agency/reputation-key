// The final Print cards section's state (final design spec §11), shown where the
// server says PRINT_KIT_FINAL_ENABLED: what the manager has chosen, the print it
// makes, the code the preview draws and the tile the file would print it on, why
// the server would refuse the print, the first sheet, and the download. The
// Portal's titles and look come from the same read as today's section
// (`usePrintKit`), which says which kit the tab shows.

import { useCallback, useMemo, useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFinalLastSettings } from '#/shared/domain/portal-print-final-last'
import { printAddressShape } from '#/shared/domain/portal-print-address'
import {
  printFinalRegionOf,
  type PrintFinalFace,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
} from '#/shared/domain/portal-print-final'
import { printFinalFileName } from '#/shared/domain/portal-print-final-how-to'
import {
  printFinalHasShopFile,
  printFinalShopPage,
} from '#/shared/domain/portal-print-final-shop'
import { printFinalSheet } from '#/shared/domain/portal-print-final-immersive-sheets'
import { printFinalOwnWordsToSend } from '#/shared/domain/portal-print-final-custom'
import { PRINT_FINAL_REFUSAL_COPY } from '#/shared/domain/portal-print-final-refusals'
import type { PortalPrintKitResources } from './portal-print-kit-types'
import {
  INITIAL_PRINT_FINAL_CHOICE,
  choiceOfLastPrint,
  printFinalIsLastSet,
  printFinalLastLook,
  printFinalShareCheck,
  printFinalShareCount,
  resolvePrintFinalChoice,
  type PrintFinalShareCheck,
  type PrintFinalShareChoice,
  type PrintFinalSharePrint,
} from './print-final-state'
import { saveBlob } from './save-file'
import { usePrintFinalWords, type PrintFinalWordsBlock } from './use-print-final-words'
import { usePrintKitCode } from './use-print-kit-code'
import { decodeBase64 } from './use-print-kit-download'

/** A version 3 symbol, which the sample and a short print address make: the tile until the code is drawn. */
const VERSION_3_MODULES = 29

/** The face the hooks lay out before the read has answered: the board's wide tent on Letter. */
const INITIAL_PRINT_FINAL_PRINT_KEY = {
  piece: INITIAL_PRINT_FINAL_CHOICE.piece,
  orientation: INITIAL_PRINT_FINAL_CHOICE.orientations[INITIAL_PRINT_FINAL_CHOICE.piece],
  look: INITIAL_PRINT_FINAL_CHOICE.look ?? 'paper',
  paper: 'letter',
} as const

type Input = Readonly<{
  portalId: string
  /** The read `usePrintKit` made; null while it reads. */
  view: PortalPrintKitView | null
  /** Off while the tab shows no print kit, or today's. */
  enabled: boolean
  countryCode: string | null
  /** The live code's QR address, when it is in memory; the preview draws a sample otherwise. */
  qrAddress: string | null
  downloadMutation: PortalPrintKitResources['downloadFinalMutation']
  /** Called once the server made a file: the print is now the Portal's last, which the read says. */
  onDownloaded: () => void
}>

/** What the download sends for a print. */
function requestOf(portalId: string, print: PrintFinalSharePrint) {
  // Only the words the manager changed from the wording are their own; prefilled fields as they stand send nothing.
  const customWords = printFinalOwnWordsToSend(print.words, print.languages)
  return {
    portalId,
    piece: print.piece,
    orientation: print.orientation,
    look: print.look,
    paper: print.paper,
    printer: print.printer,
    quantity: print.quantity ?? 1,
    fillSpares: print.fillSpares,
    cropMarks: print.cropMarks,
    backPage: print.backPage,
    ...(print.chosenPerSheet === undefined ? {} : { perSheet: print.chosenPerSheet }),
    languages: [...print.languages],
    callToAction: print.callToAction,
    ...(customWords === null ? {} : { customWords }),
  }
}

/** The kit's own refusal first: a print it cannot make says so before its words do. */
function refusalOf(
  check: PrintFinalShareCheck | null,
  wordsBlock: PrintFinalWordsBlock | null,
): string | null {
  if (check?.refusal != null) return PRINT_FINAL_REFUSAL_COPY[check.refusal]
  return wordsBlock?.note ?? null
}

function useChoice() {
  const [choice, setChoice] = useState<PrintFinalShareChoice>(INITIAL_PRINT_FINAL_CHOICE)
  const change = useCallback(
    (patch: Partial<PrintFinalShareChoice>) => setChoice((now) => ({ ...now, ...patch })),
    [],
  )
  return {
    choice,
    change,
    /** Turns the piece on show; the others keep their own orientation. */
    chooseOrientation: useCallback(
      (piece: PrintFinalPiece, orientation: PrintFinalOrientation) =>
        setChoice((now) => ({
          ...now,
          orientations: { ...now.orientations, [piece]: orientation },
        })),
      [],
    ),
    /** Sets every choice of the Portal's last print again. */
    repeatLastPrint: useCallback(
      (last: PrintFinalLastSettings) => setChoice((now) => choiceOfLastPrint(now, last)),
      [],
    ),
    /** Picks a wording, writes the manager's own words, or edits them: one change to the words. */
    changeWords: useCallback(
      (words: Pick<PrintFinalShareChoice, 'callToAction' | 'customWords'>) =>
        setChoice((now) => ({ ...now, ...words })),
      [],
    ),
    /** A print shop takes no tents: choosing it moves a tent choice to Counter cards. */
    choosePrinter: useCallback(
      (printer: PrintFinalPrinter) =>
        setChoice((now) => ({
          ...now,
          printer,
          piece: printer === 'print_shop' && now.piece === 'tent' ? 'counter' : now.piece,
        })),
      [],
    ),
  }
}

export function usePrintFinal(input: Input) {
  const { view, portalId, downloadMutation, onDownloaded } = input
  const {
    choice,
    change,
    chooseOrientation,
    choosePrinter,
    repeatLastPrint,
    changeWords,
  } = useChoice()
  const { countryCode } = input
  const lastPrint = view?.lastPrint ?? null
  // Held while the choice and the read stand, so the face is laid out once per change.
  const print = useMemo(
    () =>
      view === null
        ? null
        : resolvePrintFinalChoice(
            choice,
            view.locales,
            countryCode,
            printFinalLastLook(view.lastPrint),
          ),
    [choice, view, countryCode],
  )
  const code = usePrintKitCode(input.qrAddress, input.enabled)
  const symbolModules = code.symbolModules ?? VERSION_3_MODULES
  // Held too: its tile is what the face is laid out on.
  const check = useMemo(
    () =>
      print === null
        ? null
        : printFinalShareCheck(print, {
            address: printAddressShape(code.address),
            symbolModules,
          }),
    [print, code.address, symbolModules],
  )
  const { piece, orientation, look, paper } = print ?? INITIAL_PRINT_FINAL_PRINT_KEY
  const face = useMemo(
    (): PrintFinalFace => ({
      piece,
      orientation,
      look,
      region: printFinalRegionOf(paper),
    }),
    [piece, orientation, look, paper],
  )
  const wordsState = usePrintFinalWords({
    print,
    face,
    view,
    code: { address: printAddressShape(code.address), symbolModules },
    editWords: changeWords,
  })
  const sheet = useMemo(
    () => printFinalSheet({ piece, orientation, look, paper }),
    [piece, orientation, look, paper],
  )
  // A print shop's file: one page, with its margin and, where asked for, its crop marks (a tent has none).
  const shop = print?.printer === 'print_shop' && printFinalHasShopFile(piece)
  const cropMarks = print?.cropMarks ?? false
  const shopPage = useMemo(
    () => (shop ? printFinalShopPage({ face, cropMarks }) : null),
    [shop, face, cropMarks],
  )
  const download = useCallback(async () => {
    if (print === null || view === null || downloadMutation === undefined) return
    try {
      const file = await downloadMutation({ data: requestOf(portalId, print) })
      saveBlob(
        new Blob([decodeBase64(file.pdfBase64)], { type: file.contentType }),
        file.fileName,
      )
      // The server made the file, so it now holds this print as the Portal's last.
      // Saved first: the file is what the manager came for, the notice follows.
      onDownloaded()
    } catch {
      // The mutation has already toasted the refusal.
    }
  }, [print, view, portalId, downloadMutation, onDownloaded])
  return {
    choice,
    change,
    chooseOrientation,
    choosePrinter,
    repeatLastPrint,
    /** The Portal's last print, as the read gave it; null when it was never printed. */
    lastPrint,
    /** Whether the choices on show are already the last print's, so setting them again would change nothing. */
    isLastPrintSet: printFinalIsLastSet(print, lastPrint),
    print,
    count: print === null ? null : printFinalShareCount(print),
    code,
    /** Whether the code drawn is a sample, the live address not being in memory. */
    sample: input.qrAddress === null,
    tile: check?.tile ?? null,
    /** Why the server would refuse this print, in its own words (the words' own reason last); null when it would make it. */
    refusal: refusalOf(check, wordsState.block),
    face,
    blocks: wordsState.blocks,
    /** The call to action: the menu checked against the print, the manager's own words and their fit. */
    words: wordsState,
    sheet,
    /** The page a print shop's file has; null from the manager's own printer. */
    shopPage,
    fileName:
      print === null || view === null ? null : printFinalFileName(view.portalName, print),
    download,
    isWorking: downloadMutation?.isPending ?? false,
  } as const
}

export type PrintFinalState = ReturnType<typeof usePrintFinal>
