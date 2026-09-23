// The row's metadata strip: the facts beside the copy, never the ones in it.
//
// The title already names the Property and the copy says how often a row
// repeated, so the strip shows only what the sentences deliberately leave
// out: a locally collected rating, as stars, and how long the item had waited
// when the notice was raised. That age is fixed, like the row's own time: the
// item may have been answered since, so it never keeps counting.
//
// Every field is optional (ADR 0046 r.8 payloads carry only what was captured),
// so this renders nothing at all rather than a row of empty separators. No
// identifier ever appears here — `resourceId` lives in the deep link only.

import { Clock } from 'lucide-react'
import { StarRating } from '#/components/ui/star-rating'
import {
  waitingAge,
  type NotificationPayload,
} from '#/contexts/feed/application/public-api'

type Props = Readonly<{
  payload: NotificationPayload
  /**
   * ADR 0046 r.2 coalescing count. Not shown here: the copy says how often a
   * row repeated, once, in the words for what repeated.
   */
  coalescedCount: number
}>

export function NotificationRowMeta({ payload }: Props) {
  const waiting = waitingAge(payload)
  const rating = payload.guestRating

  if (rating === undefined && waiting === '') return null

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {rating !== undefined && (
        <StarRating value={rating} label={`Rated ${rating} out of 5 stars`} />
      )}
      {waiting !== '' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="size-3" />
          Waited {waiting}
        </span>
      )}
    </div>
  )
}
