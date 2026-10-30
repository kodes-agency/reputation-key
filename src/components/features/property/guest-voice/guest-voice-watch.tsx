import type { WatchItem } from '#/contexts/ai/application/public-api'
import { GuestVoiceIssueTitle } from './guest-voice-issue-title'
import { GuestVoiceOverflow } from './guest-voice-overflow'

export function GuestVoiceWatch({
  items,
  remaining,
}: Readonly<{ items: readonly WatchItem[]; remaining: number }>) {
  if (!items.length && !remaining) return null
  return (
    <>
      <p className="py-2 text-sm text-muted-foreground">Raised once or twice</p>
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
    </>
  )
}
