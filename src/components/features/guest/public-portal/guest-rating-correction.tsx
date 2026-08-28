import { Button } from '#/components/ui/button'
import { GuestRatingForm } from './guest-rating-form'
import type { GuestPortalCopy } from './guest-language-pack'

export function GuestRatingCorrection({
  rating,
  correcting,
  mutation,
  correctionDeadline,
  onSubmit,
  onStart,
  copy,
}: Readonly<{
  rating: number | null
  correcting: boolean
  mutation: Readonly<{ isPending: boolean; error: unknown }>
  correctionDeadline: string | null
  onSubmit: (value: Readonly<{ rating: number; honeypot: string }>) => Promise<void>
  onStart: () => void
  copy: GuestPortalCopy
}>) {
  return (
    <div className="rounded-lg border p-4">
      {correctionDeadline && (
        <p className="mb-2 text-sm">{copy.ratingCorrectionUntil(correctionDeadline)}</p>
      )}
      {correcting ? (
        <GuestRatingForm
          idPrefix="guest-rating-correction"
          initialRating={rating}
          mutation={mutation}
          copy={copy}
          submitLabel={copy.saveRatingCorrection}
          className="space-y-4"
          onSubmit={onSubmit}
        />
      ) : (
        <Button
          type="button"
          variant="link"
          onClick={onStart}
          disabled={mutation.isPending}
          className="-ml-4 text-current underline"
        >
          {copy.changePrivateRating}
        </Button>
      )}
    </div>
  )
}
