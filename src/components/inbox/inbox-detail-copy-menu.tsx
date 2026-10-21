import { useState } from 'react'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  RowActionsItem,
  RowActionsItemText,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { GOOGLE_CHECK_COPY } from './google-check-copy'
import { GoogleReviewAnchor } from './google-review-anchor'
import {
  GOOGLE_REVIEW_LINK_COPY,
  googleReviewLink,
  type GoogleReviewLink,
} from './google-review-link'
import type { GoogleReviewCheck } from './use-google-review-check'
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
function GoogleLinkItem({
  link,
  onOpened,
}: Readonly<{ link: GoogleReviewLink; onOpened?: () => void }>) {
  return (
    <RowActionsItem asChild>
      {/* The page is a new tab, so every way of opening it (click, Enter, middle
          click) is the manager leaving for Google: the Inbox watches for them
          to come back (`google-return-watcher.ts`). */}
      <GoogleReviewAnchor
        link={link}
        onClick={onOpened}
        onAuxClick={(event) => {
          // A right click only opens the browser's menu; a middle click opens the tab.
          if (event.button === 1) onOpened?.()
        }}
      >
        <ExternalLink aria-hidden="true" />
        {link.kind === 'review' ? (
          <RowActionsItemText
            label={GOOGLE_REVIEW_LINK_COPY.review}
            description={GOOGLE_REVIEW_LINK_COPY.signInHint}
          />
        ) : (
          GOOGLE_REVIEW_LINK_COPY.property
        )}
      </GoogleReviewAnchor>
    </RowActionsItem>
  )
}

/**
 * Look at Google now, without leaving. The menu stays open on the running item
 * (its spinner and "Checking Google…") and closes when Google has answered; the
 * answer is a toast.
 */
function GoogleCheckItem({
  googleCheck,
  onSettled,
}: Readonly<{ googleCheck: GoogleReviewCheck; onSettled: () => void }>) {
  return (
    <RowActionsItem
      icon={RefreshCw}
      description={GOOGLE_CHECK_COPY.actionHint}
      pending={googleCheck.isChecking}
      pendingLabel={GOOGLE_CHECK_COPY.pending}
      onSelect={(event) => {
        event.preventDefault()
        void googleCheck.check().then(onSettled)
      }}
    >
      {GOOGLE_CHECK_COPY.action}
    </RowActionsItem>
  )
}

/** The way to Google, then the check: what a manager does about a reply written there. */
function GoogleItems({
  link,
  googleCheck,
  onSettled,
}: Readonly<{
  link: GoogleReviewLink | null
  /** Only when the check is offered. */
  googleCheck: GoogleReviewCheck | undefined
  onSettled: () => void
}>) {
  return (
    <>
      {link && <GoogleLinkItem link={link} onOpened={googleCheck?.noteOpenedGoogle} />}
      {googleCheck && <GoogleCheckItem googleCheck={googleCheck} onSettled={onSettled} />}
    </>
  )
}

function CopyItems({
  reviewText,
  translation,
}: Readonly<{ reviewText: string | null; translation: string | null }>) {
  return (
    <>
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
    </>
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
  googleCheck,
}: Readonly<{
  detail: InboxDetailState['detail']
  googleCheck?: GoogleReviewCheck
}>) {
  const [open, setOpen] = useState(false)
  const reviewText = detail?.reviewText ?? null
  const translation = detail?.reviewTranslatedText ?? null
  const link = googleReviewLink(detail)
  const hasCopy = Boolean(reviewText || translation)
  const canCheck = googleCheck?.available === true
  const hasGoogle = link !== null || canCheck
  if (!hasCopy && !hasGoogle) return null

  return (
    <RowActionsMenu
      name="this review"
      variant="outline"
      open={open}
      onOpenChange={setOpen}
      // The sign-in line and the check's hint are second lines under their labels: the wide menu.
      width={link?.kind === 'review' || canCheck ? 'wide' : 'default'}
    >
      <GoogleItems
        link={link}
        googleCheck={canCheck ? googleCheck : undefined}
        onSettled={() => setOpen(false)}
      />
      {hasGoogle && hasCopy && <RowActionsSeparator />}
      <CopyItems reviewText={reviewText} translation={translation} />
    </RowActionsMenu>
  )
}
