// The final Print cards section on a phone (final design spec §11.8, the board
// share-phone): one bar pinned to the foot of the screen with the summary,
// Preview and Download PDF. Preview opens as a sheet over the page, and the
// sheet repeats the orientation control, so a manager can compare Upright and
// Wide without closing it. Below `lg`, where the preview has no column of its
// own.

import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { PortalPrintFinalPreview } from './portal-print-final-preview'
import {
  PrintFinalDownloadButton,
  PrintFinalSummaryLine,
} from './portal-print-final-section'
import { PrintFinalOrientationControl } from './print-final-orientation-control'
import type { PrintFinalState } from './use-print-final'

/** Room under the tab on a phone, so the last of it clears the bar: the bar's own height and a little more. */
const PHONE_BAR_CLEARANCE_PX = 144

type Props = Readonly<{
  final: PrintFinalState
  view: PortalPrintKitView | null
  propertyId?: string
  unavailableReason: string | null
}>

/** The pinned bar's Download, which carries the same refusal label as the desktop row (§11.5). */
function DownloadButton({
  final,
  unavailableReason,
}: Readonly<{ final: PrintFinalState; unavailableReason: string | null }>) {
  return (
    <PrintFinalDownloadButton
      final={final}
      unavailableReason={unavailableReason}
      size="lg"
      className="w-full"
    />
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
      <div aria-hidden="true" style={{ height: PHONE_BAR_CLEARANCE_PX }} />
      <div
        className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t bg-background/95 px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden"
        style={{ boxShadow: '0 -8px 20px rgb(0 0 0 / 0.08)' }}
      >
        <PrintFinalSummaryLine
          final={final}
          phone
          className="text-xs text-muted-foreground"
        />
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
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
          className="gap-3 overflow-y-auto rounded-t-xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          style={{ maxHeight: '92dvh' }}
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
