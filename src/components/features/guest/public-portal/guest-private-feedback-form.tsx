import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Honeypot } from './guest-response-fields'

export function GuestPrivateFeedbackForm({
  feedback,
  honeypot,
  pending,
  onFeedbackChange,
  onHoneypotChange,
  onSubmit,
}: Readonly<{
  feedback: string
  honeypot: string
  pending: boolean
  onFeedbackChange: (value: string) => void
  onHoneypotChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}>) {
  return (
    <form className="rounded-lg border p-5" onSubmit={onSubmit}>
      <h2 className="font-semibold">Share more with the property team</h2>
      <p className="mt-1 text-sm">
        This optional note is private. Sending it shares it with the managers responsible
        for this portal.
      </p>
      <label htmlFor="private-feedback" className="sr-only">
        Private feedback
      </label>
      <Textarea
        id="private-feedback"
        value={feedback}
        maxLength={2000}
        rows={4}
        onChange={(event) => onFeedbackChange(event.target.value)}
        className="mt-4 focus-visible:border-[color:var(--portal-primary)] focus-visible:ring-[color:var(--portal-primary)]"
      />
      <Honeypot value={honeypot} onChange={onHoneypotChange} />
      <Button type="submit" variant="outline" disabled={pending} className="mt-4">
        {pending ? 'Sending…' : 'Send private feedback'}
      </Button>
    </form>
  )
}
