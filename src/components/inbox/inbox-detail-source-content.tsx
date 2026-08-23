import { useState } from 'react'
import { Separator } from '#/components/ui/separator'
import { RatingStars } from './inbox-detail-helpers'
import { languageDisplayName } from './reply-language-options'
import { formatDate } from './utils'
import type { InboxItem, InboxItemDetail } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetail | null
  reviewReplyLanguage?: string | null
}>

function ReviewerAvatar({
  name,
  photoUrl,
}: Readonly<{ name: string; photoUrl: string | null }>) {
  const [failed, setFailed] = useState(false)
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="size-11 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

function UnavailableReview({ status }: Readonly<{ status: string | null }>) {
  if (status !== 'expired' && status !== 'not_found') return null
  return (
    <p className="text-sm text-muted-foreground">
      {status === 'expired'
        ? 'Review content unavailable (source cache expired)'
        : 'Review content unavailable'}
    </p>
  )
}

export function InboxDetailSourceContent({
  currentItem,
  detail,
  reviewReplyLanguage,
}: Props) {
  if (!detail) return null
  if (currentItem.sourceType === 'feedback') {
    return (
      <section aria-label="Guest feedback" className="space-y-3">
        {detail.feedbackRatingValue !== null && (
          <p className="text-sm font-medium">Rating {detail.feedbackRatingValue}</p>
        )}
        {detail.feedbackComment && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {detail.feedbackComment}
          </p>
        )}
      </section>
    )
  }

  const reviewerName = detail.item.reviewerName ?? 'Anonymous guest'
  const language = languageDisplayName(
    reviewReplyLanguage ?? currentItem.reviewLanguageCode,
  )
  return (
    <section aria-label="Guest review" className="space-y-5">
      <div className="flex min-w-0 items-center gap-3">
        <ReviewerAvatar
          key={detail.reviewerProfilePhotoUrl ?? reviewerName}
          name={reviewerName}
          photoUrl={detail.reviewerProfilePhotoUrl}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{reviewerName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <RatingStars rating={currentItem.rating} />
            <span>{formatDate(currentItem.sourceDate)}</span>
            {language && <span>Review language: {language}</span>}
          </div>
        </div>
      </div>

      {detail.reviewText ? (
        <p className="whitespace-pre-wrap text-base leading-relaxed">
          {detail.reviewText}
        </p>
      ) : (
        <UnavailableReview status={detail.reviewContentStatus} />
      )}

      {detail.reviewText && detail.reviewTranslatedText && (
        <div className="space-y-2 text-muted-foreground">
          <Separator />
          <p className="text-xs font-medium">Translated by Google</p>
          <p className="whitespace-pre-wrap text-base leading-relaxed">
            {detail.reviewTranslatedText}
          </p>
        </div>
      )}
    </section>
  )
}
