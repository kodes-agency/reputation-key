// "Save wording" under the call to action of the final Print cards section
// (2026-10-27): shown only while the words on show differ from the saved ones, with
// a muted line beside it saying what saving does, or why it cannot be done.

import { Button } from '#/components/ui/button'
import type { PrintFinalWordingState } from './use-print-final-wording'

export function PrintFinalSaveWording({
  wording,
}: Readonly<{ wording: PrintFinalWordingState }>) {
  if (!wording.isOffered) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={wording.reason !== null}
        pending={wording.isSaving}
        pendingLabel="Saving…"
        aria-describedby="print-final-save-wording-note"
        onClick={() => void wording.save()}
      >
        Save wording
      </Button>
      <span id="print-final-save-wording-note" className="text-xs text-muted-foreground">
        {wording.reason ?? 'Share opens with these words next time.'}
      </span>
    </div>
  )
}
