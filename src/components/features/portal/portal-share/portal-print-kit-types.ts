import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPrintKitDownload,
  PortalPrintKitView,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type {
  PrintKitCallToAction,
  PrintKitOutput,
  PrintKitPaper,
  PrintKitPiece,
  PrintKitSize,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import type {
  PrintFinalLook,
  PrintFinalOrientation,
  PrintFinalPiece,
  PrintFinalPrinter,
} from '#/shared/domain/portal-print-final'

/** The read, as the route hands it in (a server function takes its input as `data`). */
export type PortalPrintKitReader = (args: {
  data: { portalId: string }
}) => Promise<PortalPrintKitView>

export type DownloadPrintKitInput = {
  data: {
    portalId: string
    /** The print is always asked for by style and paper: the server holds the defaults, the section the choice. */
    style: PrintKitStyle
    paper: PrintKitPaper
    /** The size and output are always named too: the server's defaults are for callers that do not choose. */
    size: PrintKitSize
    output: PrintKitOutput
    piece: PrintKitPiece
    languages: GuestLocale[]
    callToAction: PrintKitCallToAction
    showPropertyName: boolean
  }
}

/** The final kit's download (PRINT_KIT_FINAL_ENABLED): every choice named, the server holds only the paper's default. */
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
    /** The optional back page of a card. */
    backPage: boolean
    perSheet?: number
    languages: GuestLocale[]
    callToAction: PrintKitCallToAction
  }
}

/** What the Print kit section needs from the route: its read and its download. */
export type PortalPrintKitResources = Readonly<{
  read: PortalPrintKitReader
  downloadMutation: Action<DownloadPrintKitInput, PortalPrintKitDownload>
  /** The final kit's download, used where the read says the server shows the final kit. */
  downloadFinalMutation?: Action<DownloadPrintFinalInput, PortalPrintKitDownload>
  /**
   * The sizes the section offers. Absent: `PRINT_KIT_SELECTABLE_SIZES`, which is
   * all the server will make; a story names the hidden ones to show them.
   */
  sizes?: readonly PrintKitSize[]
}>
