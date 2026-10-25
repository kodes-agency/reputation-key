// Where the final print's preview sits: one preview, in one of two places. From
// `lg` it is a sticky card in a column beside the section; below it, the pinned
// bar's Preview opens it as a sheet. Each place decides for itself whether it is
// the one that shows, so exactly one preview mounts (an Immersive face reads
// every word against the photo, which is worth doing once).

import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { cn } from '#/lib/utils'
import { PortalPrintFinalPhoneBar } from './portal-print-final-phone-bar'
import { PortalPrintFinalPreview } from './portal-print-final-preview'
import type { PrintFinalState } from './use-print-final'

type Props = Readonly<{
  final: PrintFinalState
  view: PortalPrintKitView | null
  propertyId?: string
  unavailableReason: string | null
}>

/** The preview column beside the section, from `lg`. */
export function PrintFinalPreviewColumn({ final, view, propertyId }: Props) {
  const stacked = useIsBelowLarge()
  if (stacked) return null
  return (
    <div className="min-w-0 flex-1 bg-muted/40">
      <div className={cn(PAGE_GUTTER_X, 'py-5 lg:sticky lg:top-0')}>
        <div className="rounded-lg border bg-card px-5 pt-4.5 pb-5">
          <PortalPrintFinalPreview
            final={final}
            view={view}
            placement="column"
            propertyId={propertyId}
          />
        </div>
      </div>
    </div>
  )
}

/** The pinned bar and its Preview sheet, below `lg`. */
export function PrintFinalPhoneSlot(props: Props) {
  const stacked = useIsBelowLarge()
  if (!stacked) return null
  return <PortalPrintFinalPhoneBar {...props} />
}
