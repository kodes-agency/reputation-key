// The Share tab's print kit, wired: whether it shows (a manager with a live
// code), the read and the download, and what the section is told. Kept out of
// PortalShare so the tab itself stays a layout.

import type { PortalShareProps } from './portal-share-types'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import { printKitAvailability } from './print-kit-state'
import { usePrintKit } from './use-print-kit'
import { usePrintKitDownload } from './use-print-kit-download'

/** Stands in for the read when the tab has no print kit; the query is off then and never calls it. */
const NO_PRINT_KIT_READ: PortalPrintKitReader = () =>
  Promise.reject(new Error('This tab has no print kit'))

type View = Readonly<{
  showActions: boolean
  showCode: boolean
  canDownloadAgain: boolean
}>

export function usePortalPrintKit(props: PortalShareProps, view: View) {
  // The print kit carries the preview beside the tab, so the tab is two
  // columns when it is on.
  const show = props.printKit !== undefined && view.showActions && view.showCode
  const printKit = usePrintKit({
    portalId: props.portalId,
    read: props.printKit?.read ?? NO_PRINT_KIT_READ,
    enabled: show,
  })
  const download = usePrintKitDownload({
    portalId: props.portalId,
    choice: printKit.choice,
    downloadMutation: props.printKit?.downloadMutation,
  })
  const availability = printKitAvailability({ canDownloadAgain: view.canDownloadAgain })
  return { show, printKit, download, unavailableReason: availability.reason }
}
