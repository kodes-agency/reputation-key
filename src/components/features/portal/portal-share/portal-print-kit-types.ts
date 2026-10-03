import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPrintKitDownload,
  PortalPrintKitView,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type {
  PrintKitCallToAction,
  PrintKitPiece,
} from '#/shared/domain/portal-print-kit'

/** The read, as the route hands it in (a server function takes its input as `data`). */
export type PortalPrintKitReader = (args: {
  data: { portalId: string }
}) => Promise<PortalPrintKitView>

export type DownloadPrintKitInput = {
  data: {
    portalId: string
    piece: PrintKitPiece
    languages: GuestLocale[]
    callToAction: PrintKitCallToAction
  }
}

/** What the Print kit section needs from the route: its read and its download. */
export type PortalPrintKitResources = Readonly<{
  read: PortalPrintKitReader
  downloadMutation: Action<DownloadPrintKitInput, PortalPrintKitDownload>
}>
