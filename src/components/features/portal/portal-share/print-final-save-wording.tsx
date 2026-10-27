// "Save wording" under the call to action of the final Print cards section
// (2026-10-27): shown only while the words on show differ from the saved ones, with
// a muted line beside it saying what saving does, or why it cannot be done.
//
// The button goes once the words are saved, and it is disabled while it saves, so a
// keyboard user's focus would fall to the page. When a save settles with focus lost,
// it goes back: to the call to action the words belong to after a save, and to
// "Save wording" itself after a refusal. A save is announced by its toast.

import { useEffect, useRef } from 'react'
import { Button } from '#/components/ui/button'
import { PRINT_FINAL_CTA_TRIGGER_ID } from './print-final-cta-select'
import type { PrintFinalWordingState } from './use-print-final-wording'

/** Focus is on the page, not on a control: the button it was on was disabled or is gone. */
const focusIsLost = () =>
  document.activeElement === null || document.activeElement === document.body

export function PrintFinalSaveWording({
  wording,
}: Readonly<{ wording: PrintFinalWordingState }>) {
  const button = useRef<HTMLButtonElement>(null)
  const wasSaving = useRef(false)
  const { isSaving } = wording
  useEffect(() => {
    const settled = wasSaving.current && !isSaving
    wasSaving.current = isSaving
    if (!settled || !focusIsLost()) return
    // Saved: the button is gone, so the control above it. Refused: it is still here.
    const target = button.current ?? document.getElementById(PRINT_FINAL_CTA_TRIGGER_ID)
    target?.focus()
  }, [isSaving])
  if (!wording.isOffered) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button
        ref={button}
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
