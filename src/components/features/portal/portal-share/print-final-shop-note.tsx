// The note for the print shop (final design spec §10.3, "Share says what to
// order"): under the order line, a button that copies the technical line to the
// clipboard, for the comments of the shop's order form. The note itself is
// words in the shop's trade (trim, bleed, TrimBox, BleedBox), so it is not set
// on the page unless the browser refuses the copy: then it is shown, selected,
// to copy by hand.

import { Check, Copy } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  PRINT_FINAL_SHOP_NOTE_BUTTON,
  PRINT_FINAL_SHOP_NOTE_COPIED,
  PRINT_FINAL_SHOP_NOTE_FAILED,
  PRINT_FINAL_SHOP_NOTE_HINT,
  printFinalShopNote,
  type PrintFinalShopPrint,
} from '#/shared/domain/portal-print-final-shop-copy'
import { useCopyLink } from './use-copy-link'

type Props = Readonly<{
  print: PrintFinalShopPrint
  /** The code's cream square as printed: the note names its size, for the shop to check on a proof. */
  tilePt: number
}>

export function PrintFinalShopNote({ print, tilePt }: Props) {
  const note = printFinalShopNote(print, tilePt)
  const { linkRef, copied, copyFailed, copyLink } = useCopyLink(note)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby="print-final-shop-note-hint"
          onClick={() => void copyLink()}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? PRINT_FINAL_SHOP_NOTE_COPIED : PRINT_FINAL_SHOP_NOTE_BUTTON}
        </Button>
        <span id="print-final-shop-note-hint" className="text-xs text-muted-foreground">
          {PRINT_FINAL_SHOP_NOTE_HINT}
        </span>
      </div>
      <span role="status" className="sr-only">
        {copied ? 'Note copied' : ''}
      </span>
      {copyFailed && (
        <>
          <p role="alert" className="text-xs text-negative">
            {PRINT_FINAL_SHOP_NOTE_FAILED}
          </p>
          <span
            ref={linkRef}
            className="block rounded-md border bg-muted/40 p-2 text-xs text-pretty"
          >
            {note}
          </span>
        </>
      )}
    </div>
  )
}
