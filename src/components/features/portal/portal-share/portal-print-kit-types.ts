import type { Action } from '#/components/hooks/use-action'
import type { PortalPrintKitDownload } from '#/contexts/portal/printing/contracts'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import type {
  PrintFinalLook,
  PrintFinalOrientation,
  PrintFinalPiece,
  PrintFinalPrinter,
} from '#/shared/domain/portal-print-final'
import type { PrintFinalCallToAction } from '#/shared/domain/portal-print-final-copy'
import type { PrintFinalCustomWords } from '#/shared/domain/portal-print-final-custom'
import type { PrintFinalSavedWording } from '#/shared/domain/portal-print-final-wording'

/** The read, as the route hands it in (a server function takes its input as `data`). */
export type PortalPrintKitReader = (args: {
  data: { portalId: string }
}) => Promise<PortalPrintKitView>

/** The print download: every choice named, the server holds only the paper's default. */
export type DownloadPrintFinalInput = {
  data: {
    portalId: string
    piece: PrintFinalPiece
    orientation: PrintFinalOrientation
    look: PrintFinalLook
    paper: PrintKitPaper
    printer: PrintFinalPrinter
    quantity: number
    fillSpares: boolean
    /** A print shop's crop marks; the manager's own printer ignores them. */
    cropMarks: boolean
    /** The optional back page of a card. */
    backPage: boolean
    perSheet?: number
    languages: GuestLocale[]
    callToAction: PrintFinalCallToAction
    /** The manager's own words per language, normalised; absent or null with none. */
    customWords?: PrintFinalCustomWords | null
  }
}

/** "Save wording" in the final kit: the wording picked, and the own words where the manager wrote them. */
export type SavePrintWordingInput = {
  data: {
    portalId: string
    callToAction: PrintFinalCallToAction
    customWords?: PrintFinalCustomWords | null
  }
}

/** What the Print kit section needs from the route: its read and its download. */
export type PortalPrintKitResources = Readonly<{
  read: PortalPrintKitReader
  /** The final kit's download, used where the read says the server shows the final kit. */
  downloadFinalMutation?: Action<DownloadPrintFinalInput, PortalPrintKitDownload>
  /** The final kit's "Save wording"; absent, Share offers none. It answers with the wording as stored. */
  saveWordingMutation?: Action<SavePrintWordingInput, PrintFinalSavedWording>
}>
