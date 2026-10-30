import type { ChangedItem } from '#/contexts/ai/application/public-api'
import { Button } from '#/components/ui/button'
import { ChangeBadge, Figures } from './guest-voice-figures'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'
import { changePill, changeSentence, topicLabel } from './guest-voice-words'

function ChangedRow({ item }: Readonly<{ item: ChangedItem }>) {
  const { onOpenIssue } = useGuestVoice()
  const pill = changePill(item.change, item.evidenceLevel, item.polarity)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      {pill === null ? null : <ChangeBadge pill={pill} />}
      <span className="min-w-0 text-sm">
        {onOpenIssue === undefined ? (
          <span className="font-semibold">{item.title}</span>
        ) : (
          <Button
            type="button"
            variant="link"
            size="inline"
            touch
            aria-haspopup="dialog"
            className="font-semibold whitespace-normal"
            onClick={() => onOpenIssue(item.issueId)}
          >
            {item.title}
          </Button>
        )}
        {item.title === topicLabel(item.topic) ? null : (
          <span className="text-muted-foreground"> · {topicLabel(item.topic)}</span>
        )}
      </span>
      <span className="basis-full text-sm text-muted-foreground @2xl:basis-auto">
        <Figures>{changeSentence(item)}</Figures>
      </span>
    </li>
  )
}

/**
 * Only the moves the engine calls likely real, against the property's own history.
 * Most weeks there are none, and the section says so rather than going away.
 */
export function GuestVoiceWhatChanged({
  items,
  provisional,
}: Readonly<{ items: readonly ChangedItem[]; provisional: boolean }>) {
  return (
    <GuestVoiceSection title="What changed" hint="Only changes that are likely real">
      {items.length === 0 ? (
        <GuestVoiceNothingHere>
          {provisional
            ? 'Changes appear once your reviews are analysed.'
            : 'Nothing has changed by more than its usual ups and downs.'}
        </GuestVoiceNothingHere>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((item) => (
            <ChangedRow key={item.issueId} item={item} />
          ))}
        </ul>
      )}
    </GuestVoiceSection>
  )
}
