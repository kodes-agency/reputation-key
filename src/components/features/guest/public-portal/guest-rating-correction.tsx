import type { FormEvent } from 'react'
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
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-current px-4 py-2 font-medium disabled:opacity-50"
          >
            Save rating correction
          </button>
        </form>
      ) : (
        <button type="button" onClick={onStart} className="text-sm underline">
          Change your private rating
        </button>
      )}
    </div>
  )
}
