import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { RatingChoices } from './guest-response-fields'

export function GuestRatingCorrection({
  rating,
  correcting,
  pending,
  correctionDeadline,
  onRatingChange,
  onSubmit,
  onStart,
}: Readonly<{
  rating: number | null
  correcting: boolean
  pending: boolean
  correctionDeadline: string | null
  onRatingChange: (value: number) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onStart: () => void
}>) {
  return (
    <div className="rounded-lg border p-4">
      {correctionDeadline && (
        <p className="mb-2 text-sm">
          Rating correction is available until{' '}
          {new Date(correctionDeadline).toLocaleString()}.
        </p>
      )}
      {correcting ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <RatingChoices value={rating} disabled={pending} onChange={onRatingChange} />
          <Button type="submit" variant="outline" disabled={pending}>
            Save rating correction
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="link"
          onClick={onStart}
          className="-ml-4 text-current underline"
        >
          Change your private rating
        </Button>
      )}
    </div>
  )
}
