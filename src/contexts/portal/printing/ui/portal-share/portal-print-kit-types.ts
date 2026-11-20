import type { Action } from '#/components/hooks/use-action'
import type { PortalPrintKitDownload } from '#/contexts/portal/printing/contracts'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import type {
  PrintLook,
  PrintOrientation,
  PrintPiece,
  PrintPrinter,
} from '#/shared/domain/portal-print'
import type { PrintCallToAction } from '#/shared/domain/portal-print-copy'
import type { PrintCustomWords } from '#/shared/domain/portal-print-custom'
import type { PrintSavedWording } from '#/shared/domain/portal-print-wording'

/** The read, as the route hands it in (a server function takes its input as `data`). */
export type PortalPrintKitReader = (args: {
  data: { portalId: string }
}) => Promise<PortalPrintKitView>

/** The print download: every choice named, the server holds only the paper's default. */
export type DownloadPrintInput = {
  data: {
    portalId: string
    piece: PrintPiece
    orientation: PrintOrientation
    look: PrintLook
    paper: PrintKitPaper
    printer: PrintPrinter
    quantity: number
    fillSpares: boolean
    /** A print shop's crop marks; the manager's own printer ignores them. */
    cropMarks: boolean
    /** The optional back page of a card. */
    backPage: boolean
    perSheet?: number
    languages: GuestLocale[]
    callToAction: PrintCallToAction
    /** The manager's own words per language, normalised; absent or null with none. */
    customWords?: PrintCustomWords | null
  }
}

/** "Save wording" in the kit: the wording picked, and the own words where the manager wrote them. */
export type SavePrintWordingInput = {
  data: {
    portalId: string
    callToAction: PrintCallToAction
    customWords?: PrintCustomWords | null
  }
}

/** What the Print kit section needs from the route: its read and its download. */
export type PortalPrintKitResources = Readonly<{
  read: PortalPrintKitReader
  /** The kit's download, used where the read says the server shows the kit. */
  downloadPrintMutation?: Action<DownloadPrintInput, PortalPrintKitDownload>
  /** The kit's "Save wording"; absent, Share offers none. It answers with the wording as stored. */
  saveWordingMutation?: Action<SavePrintWordingInput, PrintSavedWording>
}>
