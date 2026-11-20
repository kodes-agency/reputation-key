// The Share tab's print controls and adjacent preview, with the phone preview bar.

import { PortalPrintSection } from './portal-print-section'
import { PrintPhoneSlot, PrintPreviewColumn } from './portal-print-slots'
import type { usePortalPrintKit } from './use-portal-print-kit'

type Kit = ReturnType<typeof usePortalPrintKit>

/** The Print cards section, where the server shows the kit. */
export function PortalSharePrintSection({
  kit,
  countryCode,
}: Readonly<{ kit: Kit; countryCode: string | null }>) {
  if (!kit.show) return null
  const { printKit } = kit
  return (
    <PortalPrintSection
      printState={kit.printState}
      view={printKit.view}
      countryCode={countryCode}
      isError={printKit.isError}
      onRetry={printKit.retry}
      isRetrying={printKit.isRetrying}
      unavailableReason={kit.printUnavailableReason}
    />
  )
}

/** Beside the tab's column: today's preview, or the preview (a column from `lg`, the pinned bar below it). */
export function PortalSharePrintKitAside({
  kit,
  propertyId,
  portalId,
}: Readonly<{ kit: Kit; propertyId?: string; portalId?: string }>) {
  if (!kit.show) return null
  const printState = {
    printState: kit.printState,
    view: kit.printKit.view,
    propertyId,
    portalId,
    unavailableReason: kit.printUnavailableReason,
  }
  return (
    <>
      <PrintPreviewColumn {...printState} />
      <PrintPhoneSlot {...printState} />
    </>
  )
}
