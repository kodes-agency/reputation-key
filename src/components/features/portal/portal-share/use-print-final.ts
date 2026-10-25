// The final Print cards section's state (final design spec §11), shown where the
// server says PRINT_KIT_FINAL_ENABLED: what the manager has chosen, the print it
// makes, the code the preview draws and the tile the file would print it on, why
// the server would refuse the print, the first sheet, and the download. The
// Portal's titles and look come from the same read as today's section
// (`usePrintKit`), which says which kit the tab shows.

import { useCallback, useMemo, useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { printAddressShape } from '#/shared/domain/portal-print-address'
import {
  printFinalRegionOf,
  type PrintFinalFace,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
} from '#/shared/domain/portal-print-final'
import { printFinalFileName } from '#/shared/domain/portal-print-final-how-to'
import { printFinalSheet } from '#/shared/domain/portal-print-final-immersive-sheets'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import { PRINT_FINAL_REFUSAL_COPY } from '#/shared/domain/portal-print-final-refusals'
import type { PortalPrintKitResources } from './portal-print-kit-types'
import {
  INITIAL_PRINT_FINAL_CHOICE,
  printFinalShareCheck,
  printFinalShareCount,
  resolvePrintFinalChoice,
  type PrintFinalShareChoice,
  type PrintFinalSharePrint,
} from './print-final-state'
import { saveBlob } from './save-file'
import { usePrintKitCode } from './use-print-kit-code'
import { decodeBase64 } from './use-print-kit-download'

/** A version 3 symbol, which the sample and a short print address make: the tile until the code is drawn. */
const VERSION_3_MODULES = 29

/** The face the hooks lay out before the read has answered: the board's wide tent on Letter. */
const INITIAL_PRINT_FINAL_PRINT_KEY = {
  piece: INITIAL_PRINT_FINAL_CHOICE.piece,
  orientation: INITIAL_PRINT_FINAL_CHOICE.orientations[INITIAL_PRINT_FINAL_CHOICE.piece],
  look: INITIAL_PRINT_FINAL_CHOICE.look,
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
}>

/** What the download sends for a print. */
function requestOf(portalId: string, print: PrintFinalSharePrint) {
  return {
    portalId,
    piece: print.piece,
    orientation: print.orientation,
    look: print.look,
    paper: print.paper,
    printer: print.printer,
    quantity: print.quantity ?? 1,
    fillSpares: print.fillSpares,
    backPage: print.backPage,
    ...(print.chosenPerSheet === undefined ? {} : { perSheet: print.chosenPerSheet }),
    languages: [...print.languages],
    callToAction: print.callToAction,
  }
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
  const { view, portalId, downloadMutation } = input
  const { choice, change, chooseOrientation, choosePrinter } = useChoice()
  const { countryCode } = input
  // Held while the choice and the read stand, so the face is laid out once per change.
  const print = useMemo(
    () =>
      view === null ? null : resolvePrintFinalChoice(choice, view.locales, countryCode),
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
  const languages = print?.languages
  const callToAction = choice.callToAction
  const blocks = useMemo(
    () =>
      view === null || languages === undefined
        ? []
        : printFinalBlocks(languages, callToAction, view.titles, view.portalName),
    [view, languages, callToAction],
  )
  const sheet = useMemo(
    () => printFinalSheet({ piece, orientation, look, paper }),
    [piece, orientation, look, paper],
  )
  const download = useCallback(async () => {
    if (print === null || view === null || downloadMutation === undefined) return
    try {
      const file = await downloadMutation({ data: requestOf(portalId, print) })
      saveBlob(
        new Blob([decodeBase64(file.pdfBase64)], { type: file.contentType }),
        file.fileName,
      )
    } catch {
      // The mutation has already toasted the refusal.
    }
  }, [print, view, portalId, downloadMutation])
  return {
    choice,
    change,
    chooseOrientation,
    choosePrinter,
    print,
    count: print === null ? null : printFinalShareCount(print),
    code,
    /** Whether the code drawn is a sample, the live address not being in memory. */
    sample: input.qrAddress === null,
    tile: check?.tile ?? null,
    /** Why the server would refuse this print, in its own words; null when it would make it. */
    refusal: check?.refusal == null ? null : PRINT_FINAL_REFUSAL_COPY[check.refusal],
    face,
    blocks,
    sheet,
    fileName:
      print === null || view === null ? null : printFinalFileName(view.portalName, print),
    download,
    isWorking: downloadMutation?.isPending ?? false,
  } as const
}

export type PrintFinalState = ReturnType<typeof usePrintFinal>
