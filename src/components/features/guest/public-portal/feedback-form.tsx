import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'
import { useAction } from '#/components/hooks/use-action'

type SubmitFeedbackFn = (input: {
  data: {
    portalId: string
    comment: string
    source: ScanSource
    honeypot: string
    submittedAt: number
  }
}) => Promise<unknown>

type Props = Readonly<{
  portalId: string
  source: ScanSource
  submitFeedback?: SubmitFeedbackFn
}>

export function FeedbackForm({ portalId, source, submitFeedback }: Props) {
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submitAction = useAction(submitFeedback ?? (() => Promise.resolve()))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitFeedback) return

    setIsSubmitting(true)
    setError(null)

    try {
      // F123: Read honeypot value from DOM to actually enforce bot detection.
      // If the honeypot field is filled (by a bot), treat as blocked.
      const form = e.target as HTMLFormElement
      const honeypotInput = form.querySelector(
        'input[name="honeypot"]',
      ) as HTMLInputElement | null
      const honeypotValue = honeypotInput?.value ?? ''

      const result = await submitAction({
        data: {
          portalId,
          comment,
          source,
          honeypot: honeypotValue,
          submittedAt: Date.now(),
        },
      })

      if (
        typeof result === 'object' &&
        result !== null &&
        'blocked' in result &&
        (result as { blocked?: boolean }).blocked
      ) {
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
        <span className="text-xs text-inherit">{comment.length}/1000</span>
        <Button type="submit" disabled={isSubmitting || comment.trim().length === 0}>
          {isSubmitting ? 'Sending...' : 'Send Feedback'}
        </Button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  )
}
