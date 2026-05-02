import { useState } from 'react'
import { submitFeedbackFn } from '#/contexts/guest/server/public'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'

interface FeedbackFormProps {
  portalId: string
  source: ScanSource
}

export function FeedbackForm({ portalId, source }: FeedbackFormProps) {
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await submitFeedbackFn({
        data: {
          portalId,
          comment,
          source,
          honeypot: '',
          submittedAt: Date.now(),
        },
      })

      if ((result as { blocked?: boolean })?.blocked) {
        setSubmitted(true)
        return
      }

      setSubmitted(true)
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String(e.message)
          : 'Failed to submit feedback'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-4">
        <p className="text-lg font-medium">Thank you for your feedback!</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="sr-only" aria-hidden="true">
        <input
          type="text"
          name="honeypot"
          tabIndex={-1}
          autoComplete="off"
          className="absolute -left-[9999px]"
        />
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Tell us more about your experience (optional)"
        maxLength={1000}
        rows={4}
        className="resize-none"
      />
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">{comment.length}/1000</span>
        <Button type="submit" disabled={isSubmitting || comment.trim().length === 0}>
          {isSubmitting ? 'Sending...' : 'Send Feedback'}
        </Button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  )
}
