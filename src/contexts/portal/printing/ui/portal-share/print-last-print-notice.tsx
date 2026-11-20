// The Last printed notice at the top of the Print cards section (design
// spec §11, the boards share-desktop-light, share-desktop-dark and share-phone):
// when the Portal was last printed and what the print was, and for an Immersive
// print whether the photo has changed since, with "Use the same settings" to set
// that print's choices again. A Portal that was never printed has no notice, and
// once the choices on show are already the last print's the button has nothing to
// do and goes.

import { History } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { printLastNotice } from './print-last-print'
import type { PrintState } from './use-print'

type Props = Readonly<{
  printState: Pick<PrintState, 'lastPrint' | 'isLastPrintSet' | 'repeatLastPrint'>
}>

export function PrintLastPrintNotice({ printState }: Props) {
  const { lastPrint } = printState
  if (lastPrint === null) return null
  const notice = printLastNotice(lastPrint, new Date())
  return (
    <Alert className="bg-muted/50">
      <History aria-hidden="true" />
      <div className="col-start-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <AlertTitle className="line-clamp-none">{notice.title}</AlertTitle>
          {notice.photoLine === null ? null : (
            <AlertDescription>{notice.photoLine}</AlertDescription>
          )}
        </div>
        {printState.isLastPrintSet ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => printState.repeatLastPrint(lastPrint.settings)}
          >
            Use the same settings
          </Button>
        )}
      </div>
    </Alert>
  )
}
