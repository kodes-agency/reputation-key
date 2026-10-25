// The final Print cards section on a phone (final design spec §11.8, the board
// share-phone): one bar pinned to the foot of the screen with the summary,
// Preview and Download PDF. Preview opens as a sheet over the page, and the
// sheet repeats the orientation control, so a manager can compare Upright and
// Wide without closing it. Below `lg`, where the preview has no column of its
// own.

import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { PortalPrintFinalPreview } from './portal-print-final-preview'
import { PrintFinalSummaryLine } from './portal-print-final-section'
import { PrintFinalOrientationControl } from './print-final-orientation-control'
import type { PrintFinalState } from './use-print-final'

/** The tab's bottom padding on a phone, so the last of the section clears the bar. */
export const PRINT_FINAL_PHONE_BAR_CLEARANCE = 'max-lg:pb-36'

type Props = Readonly<{
  final: PrintFinalState
  view: PortalPrintKitView | null
  propertyId?: string
  unavailableReason: string | null
}>

function DownloadButton({
  final,
  unavailableReason,
}: Readonly<{ final: PrintFinalState; unavailableReason: string | null }>) {
  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      disabled={final.print === null || unavailableReason !== null}
      pending={final.isWorking}
      pendingLabel="Making the PDF…"
      onClick={() => void final.download()}
    >
      <Download /> Download PDF
    </Button>
  )
}

export function PortalPrintFinalPhoneBar({
  final,
  view,
  propertyId,
  unavailableReason,
}: Props) {
  const [open, setOpen] = useState(false)
  const { print } = final
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t bg-background/95 px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_rgb(0_0_0/0.08)] backdrop-blur-sm lg:hidden">
        <PrintFinalSummaryLine
          final={final}
          phone
          className="text-xs text-muted-foreground"
        />
        <div className="grid grid-cols-[1fr_1.6fr] gap-2">
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={print === null}
            onClick={() => setOpen(true)}
          >
            Preview
          </Button>
          <DownloadButton final={final} unavailableReason={unavailableReason} />
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="max-h-[92dvh] gap-3 overflow-y-auto rounded-t-2xl px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <span aria-hidden="true" className="mx-auto h-1 w-9 rounded-full bg-border" />
          <SheetTitle>Preview</SheetTitle>
          <PortalPrintFinalPreview
            final={final}
            view={view}
            placement="sheet"
            propertyId={propertyId}
            controls={
              print === null ? null : (
                <PrintFinalOrientationControl
                  piece={print.piece}
                  orientation={print.orientation}
                  paper={print.paper}
                  onChange={(orientation) =>
                    final.chooseOrientation(print.piece, orientation)
                  }
                  idPrefix="print-final-sheet"
                  showNote={false}
                />
              )
            }
          />
          <DownloadButton final={final} unavailableReason={unavailableReason} />
        </SheetContent>
      </Sheet>
    </>
  )
}
