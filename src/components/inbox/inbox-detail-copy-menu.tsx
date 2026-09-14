import { Copy, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { InboxDetailState } from './use-inbox-detail'

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`)
  }
}

/**
 * Overflow menu for the review body. Renders nothing until the detail payload
 * has at least one copyable text, so the trigger never appears empty.
 *
 * The trigger is a CONTROL: `max-md:size-9`, row 20's 36 px, the same square
 * as the header's dismissal beside it (`Back to list` on the sheet, `Close
 * detail` on the panel), so the row keeps one target height on a phone. v1's
 * row 15 made all three 44 px, and its neighbours then were Escalate/Resolve
 * and Close; Escalate has since moved to the case toolbar (row 5) and every
 * control left on this row is 36. Measured in Chromium against Storybook dev
 * (`inbox-mobile-390--review-closed`): 44x44 before, 36x36 after, at 390 and
 * 320; 32x32 from `md` up, where no `max-md:` class matches.
 *
 * The two rows inside are MENU ITEMS and keep `max-md:min-h-11`. Row 20
 * lowered controls, not items: items stack edge to edge with no gap, so a
 * thumb that misses one selects its neighbour — measured 44 px tall with the
 * menu open at 390 — and they never inflated the row they open from.
 */
export function InboxDetailCopyMenu({
  detail,
}: Readonly<{ detail: InboxDetailState['detail'] }>) {
  const reviewText = detail?.reviewText ?? null
  const translation = detail?.reviewTranslatedText ?? null
  if (!reviewText && !translation) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="outline"
          className="max-md:size-9"
          aria-label="More review actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {reviewText && (
          <DropdownMenuItem
            className="max-md:min-h-11"
            onSelect={() => void copyText(reviewText, 'Review text')}
          >
            <Copy data-icon="inline-start" />
            Copy review text
          </DropdownMenuItem>
        )}
        {translation && (
          <DropdownMenuItem
            className="max-md:min-h-11"
            onSelect={() => void copyText(translation, 'Translation')}
          >
            <Copy data-icon="inline-start" />
            Copy translation
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
