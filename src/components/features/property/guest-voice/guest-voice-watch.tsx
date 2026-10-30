import type { WatchItem } from '#/contexts/ai/application/public-api'
import { GuestVoiceDisclosure } from './guest-voice-disclosure'
import { GuestVoiceIssueTitle } from './guest-voice-issue-title'
import { GuestVoiceOverflow } from './guest-voice-overflow'
import { otherConcernsLabel } from './guest-voice-check-in-words'

export function GuestVoiceWatch({
  items,
  remaining,
}: Readonly<{ items: readonly WatchItem[]; remaining: number }>) {
  if (!items.length && !remaining) return null
  return (
    <GuestVoiceDisclosure label={otherConcernsLabel(items.length + remaining)}>
      <p className="py-2 text-sm text-muted-foreground">
        Mentioned once or twice. Not a pattern yet.
      </p>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.issueId}>
            <GuestVoiceIssueTitle
              issueId={item.issueId}
              title={item.title}
              topic={item.topic}
            >
              <span className="font-normal text-muted-foreground">
                {item.reviewCount} {item.reviewCount === 1 ? 'guest' : 'guests'}
              </span>
            </GuestVoiceIssueTitle>
          </li>
        ))}
      </ul>
      <GuestVoiceOverflow count={remaining} label="other concerns" />
    </GuestVoiceDisclosure>
  )
}
