import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import type { InboxDetailState } from './use-inbox-detail'

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Couldn't copy the ${label.toLowerCase()}.`)
  }
}

/**
 * Overflow menu for the review body. Renders nothing until the detail payload
 * has at least one copyable text, so the trigger never appears empty.
 *
 * The trigger is a CONTROL, the shared `RowActionsMenu` one (outline, among the
 * header's other outline squares): 36 px below `md` from the Inbox's compact
 * density (row 20), the same square as the header's dismissal beside it
 * (`Back to list` on the sheet, `Close detail` on the panel), so the row keeps
 * one target height on a phone; 32 px from `md` up.
 *
 * The two rows inside are MENU ITEMS, and the menu primitive makes them 44 px on
 * a phone. Row 20 lowered controls, not items: items stack edge to edge with no
 * gap, so a thumb that misses one selects its neighbour, and they never
 * inflated the row they open from.
 */
export function InboxDetailCopyMenu({
  detail,
}: Readonly<{ detail: InboxDetailState['detail'] }>) {
  const reviewText = detail?.reviewText ?? null
  const translation = detail?.reviewTranslatedText ?? null
  if (!reviewText && !translation) return null

  return (
    <RowActionsMenu name="this review" variant="outline">
      {reviewText && (
        <RowActionsItem
          icon={Copy}
          onSelect={() => void copyText(reviewText, 'Review text')}
        >
          Copy review text
        </RowActionsItem>
      )}
      {translation && (
        <RowActionsItem
          icon={Copy}
          onSelect={() => void copyText(translation, 'Translation')}
        >
          Copy translation
        </RowActionsItem>
      )}
    </RowActionsMenu>
  )
}
