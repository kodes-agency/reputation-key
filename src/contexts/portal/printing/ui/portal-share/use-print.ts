// The Print cards section's state (design spec §11), shown where the
// server says the print kit: what the manager has chosen, the print it
// makes, the code the preview draws and the tile the file would print it on, why
// the server would refuse the print, the first sheet, and the download. The
// Portal's titles and look come from the same read as today's section
// (`usePrintKit`), which says which kit the tab shows.

import { useCallback, useMemo, useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { PrintLastSettings } from '#/shared/domain/portal-print-last'
import { printAddressShape } from '#/shared/domain/portal-print-address'
import {
  printRegionOf,
  type PrintFace,
  type PrintOrientation,
  type PrintPiece,
  type PrintPrinter,
} from '#/shared/domain/portal-print'
import { printFileName } from '#/shared/domain/portal-print-how-to'
import { printHasShopFile, printShopPage } from '#/shared/domain/portal-print-shop'
import { printSheet } from '#/shared/domain/portal-print-immersive-sheets'
import { printOwnWordsToSend } from '#/shared/domain/portal-print-custom'
import { PRINT_REFUSAL_COPY } from '#/shared/domain/portal-print-refusals'
import type { PortalPrintKitResources } from './portal-print-kit-types'
import {
  INITIAL_PRINT_CHOICE,
  choiceOfLastPrint,
  printIsLastSet,
  printLastLook,
  printShareCheck,
  printShareCount,
  resolvePrintChoice,
  type PrintShareCheck,
  type PrintShareChoice,
  type PrintSharePrint,
} from './print-state'
import { saveBlob } from './save-file'
import { printWordingToSave } from '#/shared/domain/portal-print-wording'
import { usePrintWording } from './use-print-wording'
import { usePrintWords, type PrintWordsBlock } from './use-print-words'
import { usePrintKitCode } from './use-print-kit-code'
import { decodeBase64 } from './use-print-kit-download'
import { previewBackLayout } from './print-face-layout'

/** A version 3 symbol, which the sample and a short print address make: the tile until the code is drawn. */
const VERSION_3_MODULES = 29

/** The face the hooks lay out before the read has answered: the board's wide tent on Letter. */
const INITIAL_PRINT_PRINT_KEY = {
  piece: INITIAL_PRINT_CHOICE.piece,
  orientation: INITIAL_PRINT_CHOICE.orientations[INITIAL_PRINT_CHOICE.piece],
  look: INITIAL_PRINT_CHOICE.look ?? 'paper',
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
  downloadMutation: PortalPrintKitResources['downloadPrintMutation']
  /** "Save wording"; absent, Share offers none. */
  saveWordingMutation: PortalPrintKitResources['saveWordingMutation']
  /** Called once the server made a file: the print is now the Portal's last, which the read says. */
  onDownloaded: () => void
  /** Called once the server saved the wording, which the read says too: the next visit opens on it. */
  onWordingSaved: () => void
}>

/** What the download sends for a print. */
function requestOf(portalId: string, print: PrintSharePrint) {
  // Only the words the manager changed from the wording are their own; prefilled fields as they stand send nothing.
  const customWords = printOwnWordsToSend(print.words, print.languages)
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
  check: PrintShareCheck | null,
  wordsBlock: PrintWordsBlock | null,
  backFits: boolean,
): string | null {
  if (check?.refusal != null) return PRINT_REFUSAL_COPY[check.refusal]
  if (!backFits) return PRINT_REFUSAL_COPY.words_do_not_fit
  return wordsBlock?.note ?? null
}

function usePrintShopPage(print: PrintSharePrint | null, face: PrintFace) {
  // A print shop's file: one page, with its margin and, where asked for, its crop marks (a tent has none).
  const shop = print?.printer === 'print_shop' && printHasShopFile(face.piece)
  const cropMarks = print?.cropMarks ?? false
  return useMemo(
    () => (shop ? printShopPage({ face, cropMarks }) : null),
    [shop, face, cropMarks],
  )
}

function useChoice() {
  const [choice, setChoice] = useState<PrintShareChoice>(INITIAL_PRINT_CHOICE)
  const change = useCallback(
    (patch: Partial<PrintShareChoice>) => setChoice((now) => ({ ...now, ...patch })),
    [],
  )
  return {
    choice,
    change,
    /** Turns the piece on show; the others keep their own orientation. */
    chooseOrientation: useCallback(
      (piece: PrintPiece, orientation: PrintOrientation) =>
        setChoice((now) => ({
          ...now,
          orientations: { ...now.orientations, [piece]: orientation },
        })),
      [],
    ),
    /** Sets every choice of the Portal's last print again. */
    repeatLastPrint: useCallback(
      (last: PrintLastSettings) => setChoice((now) => choiceOfLastPrint(now, last)),
      [],
    ),
    /** Picks a wording, writes the manager's own words, or edits them: one change to the words. */
    changeWords: useCallback(
      (words: Pick<PrintShareChoice, 'callToAction' | 'customWords'>) =>
        setChoice((now) => ({ ...now, ...words })),
      [],
    ),
    /** A print shop takes no tents: choosing it moves a tent choice to Counter cards. */
    choosePrinter: useCallback(
      (printer: PrintPrinter) =>
        setChoice((now) => ({
          ...now,
          printer,
          piece: printer === 'print_shop' && now.piece === 'tent' ? 'counter' : now.piece,
        })),
      [],
    ),
  }
}

export function usePrint(input: Input) {
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
        : resolvePrintChoice(
            choice,
            view.locales,
            countryCode,
            printLastLook(view.lastPrint),
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
        : printShareCheck(print, {
            address: printAddressShape(code.address),
            symbolModules,
          }),
    [print, code.address, symbolModules],
  )
  const { piece, orientation, look, paper } = print ?? INITIAL_PRINT_PRINT_KEY
  const face = useMemo(
    (): PrintFace => ({
      piece,
      orientation,
      look,
      region: printRegionOf(paper),
    }),
    [piece, orientation, look, paper],
  )
  const wordsState = usePrintWords({
    print,
    face,
    view,
    code: { address: printAddressShape(code.address), symbolModules },
    editWords: changeWords,
  })
  const backFits = useMemo(
    () =>
      print?.backPage !== true ||
      view === null ||
      previewBackLayout({
        face,
        look: view.look,
        logoAspect: null,
        onPlate: face.look === 'immersive',
      }).plan.fits,
    [print?.backPage, face, view],
  )
  const wording = usePrintWording({
    portalId,
    view,
    print,
    saveMutation: input.saveWordingMutation,
    open: changeWords,
    onSaved: input.onWordingSaved,
  })
  const { savedByDownload } = wording
  const sheet = useMemo(
    () => printSheet({ piece, orientation, look, paper }),
    [piece, orientation, look, paper],
  )
  const shopPage = usePrintShopPage(print, face)
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
      // The server saved the wording that printed, so the words on show are saved.
      savedByDownload(printWordingToSave(print.words, print.languages))
    } catch {
      // The mutation has already toasted the refusal.
    }
  }, [print, view, portalId, downloadMutation, onDownloaded, savedByDownload])
  return {
    choice,
    change,
    chooseOrientation,
    choosePrinter,
    repeatLastPrint,
    /** The Portal's last print, as the read gave it; null when it was never printed. */
    lastPrint,
    /** Whether the choices on show are already the last print's, so setting them again would change nothing. */
    isLastPrintSet: printIsLastSet(print, lastPrint),
    print,
    count: print === null ? null : printShareCount(print),
    code,
    /** Whether the code drawn is a sample, the live address not being in memory. */
    sample: input.qrAddress === null,
    tile: check?.tile ?? null,
    /** Why the server would refuse this print, in its own words (the words' own reason last); null when it would make it. */
    refusal: refusalOf(check, wordsState.block, backFits),
    face,
    blocks: wordsState.blocks,
    /** The call to action: the menu checked against the print, the manager's own words and their fit. */
    words: wordsState,
    /** The saved wording: Share opens on it, and "Save wording" keeps the words on show for next time. */
    wording,
    sheet,
    /** The page a print shop's file has; null from the manager's own printer. */
    shopPage,
    fileName:
      print === null || view === null ? null : printFileName(view.portalName, print),
    download,
    isWorking: downloadMutation?.isPending ?? false,
  } as const
}

export type PrintState = ReturnType<typeof usePrint>
