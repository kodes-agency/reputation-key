// The Share tab's print controls and adjacent preview, with the phone preview bar.

import { PortalPrintFinalSection } from './portal-print-final-section'
import { PrintFinalPhoneSlot, PrintFinalPreviewColumn } from './portal-print-final-slots'
import type { usePortalPrintKit } from './use-portal-print-kit'

type Kit = ReturnType<typeof usePortalPrintKit>

/** The final Print cards section, where the server shows the final kit. */
export function PortalSharePrintFinalSection({
  kit,
  countryCode,
}: Readonly<{ kit: Kit; countryCode: string | null }>) {
  if (!kit.show) return null
  const { printKit } = kit
  return (
    <PortalPrintFinalSection
      final={kit.final}
      view={printKit.view}
      countryCode={countryCode}
      isError={printKit.isError}
      onRetry={printKit.retry}
      isRetrying={printKit.isRetrying}
      unavailableReason={kit.finalUnavailableReason}
    />
  )
}

/** Beside the tab's column: today's preview, or the final preview (a column from `lg`, the pinned bar below it). */
export function PortalSharePrintKitAside({
  kit,
  propertyId,
  portalId,
}: Readonly<{ kit: Kit; propertyId?: string; portalId?: string }>) {
  if (!kit.show) return null
  const final = {
    final: kit.final,
    view: kit.printKit.view,
    propertyId,
    portalId,
    unavailableReason: kit.finalUnavailableReason,
  }
  return (
    <>
      <PrintFinalPreviewColumn {...final} />
      <PrintFinalPhoneSlot {...final} />
    </>
  )
}
