// The Share tab's print kit, wired: whether it shows (a manager with a live
// code), the read and the download, and what the section is told. A print is made
// from the live version, so a portal with none gets one notice in place of the
// section and the preview, and no read. Kept out of PortalShare so the tab itself
// stays a layout.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PortalShareProps } from './portal-share-types'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import {
  describePrintKitNotLive,
  isNothingLiveRefusal,
  printKitAvailability,
  printKitHasLiveVersion,
} from './print-kit-state'
import { usePrintFinal } from './use-print-final'
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
  const offered = props.printKit !== undefined && view.showActions && view.showCode
  // Nothing live is told by the state first, so the read is not made at all; the
  // server's refusal is the fallback for a page whose state is behind.
  const hasLive = printKitHasLiveVersion(props.publicationState)
  const printKit = usePrintKit({
    portalId: props.portalId,
    read: props.printKit?.read ?? NO_PRINT_KIT_READ,
    enabled: offered && hasLive,
    countryCode: props.countryCode ?? null,
    qrAddress: props.issuedLink?.publicUrl ?? null,
    sizes: props.printKit?.sizes,
  })
  const nothingLive = offered && (!hasLive || isNothingLiveRefusal(printKit.error))
  const show = offered && !nothingLive
  const notLive = nothingLive
    ? describePrintKitNotLive(props.publicationState, props)
    : null
  // A choice kept from when the portal was live must not make a file now.
  const download = usePrintKitDownload({
    portalId: props.portalId,
    choice: show ? printKit.choice : null,
    downloadMutation: props.printKit?.downloadMutation,
  })
  // Why no print can be made at all: nothing live, or a code that cannot be fetched again.
  const blocked =
    notLive?.body ??
    printKitAvailability({ canDownloadAgain: view.canDownloadAgain }).reason
  const final = usePortalPrintFinal(props, show ? printKit.view : null)
  return {
    show,
    notLive,
    printKit,
    download,
    unavailableReason: blocked ?? printKit.refusal,
    isFinal: final.isFinal,
    final: final.state,
    finalUnavailableReason: blocked ?? final.state.refusal,
  }
}

/**
 * The final Print cards section's state, live only where the read says the
 * server shows the final kit (PRINT_KIT_FINAL_ENABLED); today's kit otherwise.
 */
function usePortalPrintFinal(props: PortalShareProps, read: PortalPrintKitView | null) {
  const isFinal = read?.kit === 'final'
  const state = usePrintFinal({
    portalId: props.portalId,
    view: isFinal ? read : null,
    enabled: isFinal,
    countryCode: props.countryCode ?? null,
    qrAddress: props.issuedLink?.publicUrl ?? null,
    downloadMutation: isFinal ? props.printKit?.downloadFinalMutation : undefined,
  })
  return { isFinal, state }
}
