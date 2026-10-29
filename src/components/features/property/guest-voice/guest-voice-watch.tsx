import { Button } from '#/components/ui/button'
import type { WatchItem } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceSection } from './guest-voice-section'
import { reviewsPhrase } from './guest-voice-words'

/**
 * Problems named once or twice: counts only, no stars, no trend. One guest's complaint
 * is not a pattern, but it is worth knowing it is there. Each opens its drawer.
 */
export function GuestVoiceWatch({ items }: Readonly<{ items: readonly WatchItem[] }>) {
  const { onOpenIssue } = useGuestVoice()
  if (items.length === 0) return null
  return (
    <GuestVoiceSection title="Watch" hint="Mentioned once or twice. Not a pattern yet.">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.issueId}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              onClick={() => onOpenIssue(item.issueId)}
            >
              <span>
                <span className="font-medium">{item.title}</span>
                <span className="font-normal text-muted-foreground">
                  {' · '}
                  {reviewsPhrase(item.reviewCount)}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </GuestVoiceSection>
  )
}
