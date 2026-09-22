// The row's metadata strip: where, how bad, how long.
//
// Every field is optional (ADR 0046 r.8 payloads carry only what was captured),
// so this renders nothing at all rather than a row of empty separators. No
// identifier ever appears here — `resourceId` lives in the deep link only.
//
// The waiting age is measured now, from when the current wait began, and only
// a notice about something still waiting carries that instant.

import { Clock } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
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
  const waiting = waitingAge(payload, new Date())
  const hasProperty = payload.propertyName !== undefined
  const hasRating = payload.guestRating !== undefined

  if (!hasProperty && !hasRating && waiting === '') return null

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {hasProperty && (
        // `min-w-0 shrink` (overriding the badge's own `shrink-0`) lets the chip
        // give up width inside the wrapping flex row, so a very long property
        // name truncates at whatever the container allows instead of pushing the
        // row wider. No magic pixel cap.
        <Badge
          variant="outline"
          className="min-w-0 shrink justify-start font-normal text-muted-foreground"
        >
          <span className="truncate">{payload.propertyName}</span>
        </Badge>
      )}
      {hasRating && payload.guestRating !== undefined && (
        <StarRating
          value={payload.guestRating}
          label={`Rated ${payload.guestRating} out of 5 stars`}
        />
      )}
      {waiting !== '' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="size-3" />
          Waiting {waiting}
        </span>
      )}
    </div>
  )
}
