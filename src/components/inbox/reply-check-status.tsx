import { cn } from '#/lib/utils'
import { GoogleLinkedText } from './google-review-anchor'
import type { GoogleReviewLink } from './google-review-link'
import { MESSAGE_PROSE_CLASS } from './guest-message'
import type { ReactNode } from 'react'

/**
 * The line under a reply's actions that says what the last "Check Google
 * again" found when the reply itself did not change (plan D7).
 *
 * ALWAYS mounted, empty until there is something to say. A live region
 * announces only what changes after it is in the document, so a `role="status"`
 * that mounted together with its sentence would be silent — the opposite of
 * the publish-blocked reason in `reply-message-actions.tsx`, which is present
 * from first render and is deliberately NOT a live region. `empty:mt-0` keeps
 * the empty line from adding the gap it takes when it speaks.
 *
 * A line that sends the manager to Google ("Look at the review on Google.")
 * links there when the review has a page on Google (`googleReviewLink`).
 */
export function ReplyCheckStatus({
  message,
  googleLink = null,
}: Readonly<{
  message: string | null
  googleLink?: GoogleReviewLink | null
}>): ReactNode {
  return (
    <p
      role="status"
      className={cn(MESSAGE_PROSE_CLASS, 'mt-2 text-xs text-muted-foreground empty:mt-0')}
    >
      {message === null ? null : <GoogleLinkedText text={message} link={googleLink} />}
    </p>
  )
}
