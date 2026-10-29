import { useId } from 'react'
import type { IssueDrawer } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceQuote } from './guest-voice-quote'

/**
 * The reviews behind an issue, in the guests' own words, read live. A review that names
 * a person is not quoted here (decision Q5), and nor is one whose text has changed or
 * gone; the line under the quotes says how many of the reviews they are, and the Inbox
 * has every one.
 */
export function GuestVoiceEvidence({ drawer }: Readonly<{ drawer: IssueDrawer }>) {
  const { propertyId } = useGuestVoice()
  const headingId = useId()
  const quoted = drawer.liveEvidence.length
  const total = drawer.statistics.reviewCount
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-sm font-semibold">
        In guests’ own words
      </h3>
      {quoted === 0 ? (
        <p className="text-sm text-muted-foreground">
          None of these reviews can be quoted here. They are all in the inbox.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {drawer.liveEvidence.map((evidence) => (
            <li key={evidence.inboxItemId} className="py-3 first:pt-0 last:pb-0">
              <GuestVoiceQuote
                evidence={evidence}
                sense="complaint"
                propertyId={propertyId}
              />
            </li>
          ))}
        </ul>
      )}
      {quoted > 0 && quoted < total ? (
        <p className="text-xs text-muted-foreground">
          Showing {quoted} of {total} reviews. The rest are in the inbox; a review that
          names a person is not quoted here.
        </p>
      ) : null}
    </section>
  )
}
