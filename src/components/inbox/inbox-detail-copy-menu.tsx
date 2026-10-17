import { Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { GoogleReviewAnchor } from './google-review-anchor'
import {
  GOOGLE_REVIEW_LINK_COPY,
  googleReviewLink,
  type GoogleReviewLink,
} from './google-review-link'
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
 * The way to Google, first in the menu. The review's own page is the merchant
 * view, so it says that Google may want the account that manages the profile;
 * the Property's reviews page opens signed out and needs no such line.
 */
function GoogleLinkItem({ link }: Readonly<{ link: GoogleReviewLink }>) {
  return (
    <RowActionsItem asChild>
      <GoogleReviewAnchor link={link}>
        <ExternalLink aria-hidden="true" />
        {link.kind === 'review' ? (
          <span className="flex flex-col">
            <span>{GOOGLE_REVIEW_LINK_COPY.review}</span>
            <span className="text-xs text-muted-foreground">
              {GOOGLE_REVIEW_LINK_COPY.signInHint}
            </span>
          </span>
        ) : (
          GOOGLE_REVIEW_LINK_COPY.property
        )}
      </GoogleReviewAnchor>
    </RowActionsItem>
  )
}

/**
 * Overflow menu for the review body. Renders nothing until the detail payload
 * has at least one copyable text or a way to the review on Google, so the
 * trigger never appears empty. A rating-only review with a Google page gets the
 * menu for the link alone.
 *
 * The trigger is a CONTROL, the shared `RowActionsMenu` one (outline, among the
 * header's other outline squares): 36 px below `md` from the Inbox's compact
 * density (row 20), the same square as the header's dismissal beside it
 * (`Back to list` on the sheet, `Close detail` on the panel), so the row keeps
 * one target height on a phone; 32 px from `md` up.
 *
 * The rows inside are MENU ITEMS, and the menu primitive makes them 44 px on a
 * phone. Row 20 lowered controls, not items: items stack edge to edge with no
 * gap, so a thumb that misses one selects its neighbour, and they never
 * inflated the row they open from. The Google item is a real link (a new tab,
 * no referrer), so it can also be opened the way a browser opens any link.
 */
export function InboxDetailCopyMenu({
  detail,
}: Readonly<{ detail: InboxDetailState['detail'] }>) {
  const reviewText = detail?.reviewText ?? null
  const translation = detail?.reviewTranslatedText ?? null
  const link = googleReviewLink(detail)
  const hasCopy = Boolean(reviewText || translation)
  if (!hasCopy && link === null) return null

  return (
    <RowActionsMenu
      name="this review"
      variant="outline"
      // The sign-in line is a second line under its label: the wide menu.
      width={link?.kind === 'review' ? 'wide' : 'default'}
    >
      {link && <GoogleLinkItem link={link} />}
      {link && hasCopy && <RowActionsSeparator />}
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
