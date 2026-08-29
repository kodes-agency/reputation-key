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
        <Button size="icon-sm" variant="outline" aria-label="More review actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {reviewText && (
          <DropdownMenuItem onSelect={() => void copyText(reviewText, 'Review text')}>
            <Copy data-icon="inline-start" />
            Copy review text
          </DropdownMenuItem>
        )}
        {translation && (
          <DropdownMenuItem onSelect={() => void copyText(translation, 'Translation')}>
            <Copy data-icon="inline-start" />
            Copy translation
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
