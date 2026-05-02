import { useState } from 'react'
import { submitRatingFn } from '#/contexts/guest/server/public'
import { Star } from 'lucide-react'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'

interface StarRatingProps {
  portalId: string
  source: ScanSource
}

export function StarRating({ portalId, source }: StarRatingProps) {
  const [selectedValue, setSelectedValue] = useState<number | null>(null)
  const [hoveredValue, setHoveredValue] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (value: number) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await submitRatingFn({
        data: { portalId, value, source },
      })
      setSelectedValue(value)
      setSubmitted(true)
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String(e.message)
          : 'Failed to submit rating'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center space-y-3 py-4">
        <p className="text-lg font-medium">Thank you for your feedback!</p>
        <div className="flex justify-center gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={`size-8 ${i < (selectedValue ?? 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-gray-500">How was your experience?</p>
      <fieldset className="flex justify-center gap-1" aria-label="Rating">
        {Array.from({ length: 5 }, (_, i) => {
          const value = i + 1
          const isActive = (hoveredValue ?? selectedValue ?? 0) >= value
          return (
            <label
              key={value}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredValue(value)}
              onMouseLeave={() => setHoveredValue(null)}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                className="sr-only"
                onChange={() => handleSubmit(value)}
                disabled={isSubmitting}
                aria-label={`${value} star${value > 1 ? 's' : ''}`}
              />
              <Star
                className={`size-10 transition-colors ${
                  isActive ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                }`}
              />
            </label>
          )
        })}
      </fieldset>
      {error && <p className="text-center text-red-500 text-sm">{error}</p>}
    </div>
  )
}
