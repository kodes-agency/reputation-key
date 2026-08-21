// The row's metadata strip: where, how bad, how long, how many.
//
// Every field is optional (ADR 0046 r.8 payloads carry only what was captured),
// so this renders nothing at all rather than a row of empty separators. No
// identifier ever appears here — `resourceId` lives in the deep link only.

import { Clock, Layers } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { StarRating } from '#/components/ui/star-rating'
import {
  formatWaitingAge,
  type NotificationPayload,
} from '#/contexts/notification/application/public-api'

type Props = Readonly<{
  payload: NotificationPayload
  /** ADR 0046 r.2 coalescing count. 1 means "not coalesced" and is not shown. */
  coalescedCount: number
}>

export function NotificationRowMeta({ payload, coalescedCount }: Props) {
  const waiting = formatWaitingAge(payload.waitingHours)
  const hasProperty = payload.propertyName !== undefined
  const hasRating = payload.rating !== undefined
  const hasRepeats = coalescedCount > 1

  if (!hasProperty && !hasRating && waiting === '' && !hasRepeats) return null

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
      {hasRating && payload.rating !== undefined && (
        <StarRating
          value={payload.rating}
          label={`Rated ${payload.rating} out of 5 stars`}
        />
      )}
      {waiting !== '' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="size-3" />
          Waiting {waiting}
        </span>
      )}
      {hasRepeats && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Layers aria-hidden="true" className="size-3" />
          Updated {coalescedCount} times
        </span>
      )}
    </div>
  )
}
