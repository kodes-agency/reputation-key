// The Share tab's print kit, in the two places the tab puts it: the section in
// the tab's column, and the preview beside it. The read says which kit the
// server shows: today's Print kit, or the final Print cards section where
// PRINT_KIT_FINAL_ENABLED is on (which leads the tab, as its boards draw it, and
// on a phone keeps its preview behind the pinned bar). Kept out of PortalShare so
// the tab itself stays a layout.

import { PortalPrintKitPreviewSlot } from './portal-print-kit-preview-slot'
import { PortalPrintKitSection } from './portal-print-kit-section'
import { PortalPrintFinalSection } from './portal-print-final-section'
import { PrintFinalPhoneSlot, PrintFinalPreviewColumn } from './portal-print-final-slots'
import type { usePortalPrintKit } from './use-portal-print-kit'

type Kit = ReturnType<typeof usePortalPrintKit>

/** The final Print cards section, where the server shows the final kit. */
export function PortalSharePrintFinalSection({
  kit,
  countryCode,
}: Readonly<{ kit: Kit; countryCode: string | null }>) {
  if (!kit.isFinal) return null
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

/** Today's Print kit section, where the server shows today's kit. */
export function PortalSharePrintKitSection({ kit }: Readonly<{ kit: Kit }>) {
  if (!kit.show || kit.isFinal) return null
  const { printKit, download } = kit
  return (
    <PortalPrintKitSection
      view={printKit.view}
      choice={printKit.choice}
      isError={printKit.isError}
      onRetry={printKit.retry}
      isRetrying={printKit.isRetrying}
      onChoiceChange={printKit.setChoice}
      sizes={printKit.sizes}
      barMeasure={printKit.barMeasure}
      unprintableNote={printKit.unprintableNote}
      softPhotoNote={printKit.softPhotoNote}
      unavailableReason={kit.unavailableReason}
      isWorking={download.isWorking}
      onDownload={() => void download.download()}
      preview={<PortalPrintKitPreviewSlot where="inline" printKit={printKit} />}
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
  if (!kit.isFinal)
    return <PortalPrintKitPreviewSlot where="column" printKit={kit.printKit} />
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
