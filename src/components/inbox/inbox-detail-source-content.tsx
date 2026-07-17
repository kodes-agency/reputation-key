// Source content display — review text, feedback, or an honest unavailable
// state when the source content is no longer eligible (BQC-1.2: raw copies
// are never stored, so there is no snippet fallback).
import { useState } from 'react'
import { RatingStars } from './inbox-detail-helpers'
import { formatDateTime } from './utils'
import type { InboxItem, InboxItemDetail } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetail | null
}>

export function InboxDetailSourceContent({ currentItem, detail }: Props) {
  // FE-28 FIX: track img load failure for broken reviewer photo URLs
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <>
      {currentItem.sourceType === 'review' && detail && (
        <div className="space-y-3">
          {detail.item.reviewerName && (
            <div className="flex items-center gap-3">
              {detail.reviewerProfilePhotoUrl && !imgFailed ? (
                <img
                  src={detail.reviewerProfilePhotoUrl}
                  alt={detail.item.reviewerName}
                  className="size-10 rounded-full object-cover"
                  onError={() => setImgFailed(true)}
                />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <span className="text-sm font-medium">
                    {detail.item.reviewerName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{detail.item.reviewerName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(currentItem.sourceDate)}
                </p>
              </div>
            </div>
          )}
          <RatingStars rating={currentItem.rating} />
          {detail.reviewText && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {detail.reviewText}
              </p>
            </div>
          )}
        </div>
      )}

      {currentItem.sourceType === 'feedback' && detail && (
        <div className="space-y-3">
          {detail.feedbackRatingValue !== null && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rating:</span>
              <span className="text-sm font-medium">{detail.feedbackRatingValue}</span>
            </div>
          )}
          {detail.feedbackComment && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {detail.feedbackComment}
              </p>
            </div>
          )}
        </div>
      )}

      {currentItem.sourceType === 'review' &&
        detail?.reviewContentStatus === 'expired' && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">
              Review content unavailable (source cache expired)
            </p>
          </div>
        )}

      {currentItem.sourceType === 'review' &&
        detail?.reviewContentStatus === 'not_found' && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">Review content unavailable</p>
          </div>
        )}
    </>
  )
}
