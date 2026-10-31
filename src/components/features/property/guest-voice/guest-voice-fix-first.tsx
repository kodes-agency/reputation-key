import type { GuestVoiceV2Ready } from '#/contexts/ai/application/public-api'
import { GuestVoiceIssueTitle } from './guest-voice-issue-title'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'
import { GuestVoiceDisclosure } from './guest-voice-disclosure'
import { GuestVoiceWatch } from './guest-voice-watch'
import {
  fixAnswer,
  lastMentionedText,
  otherConcernsLabel,
} from './guest-voice-check-in-words'
import { GuestVoiceOverflow } from './guest-voice-overflow'
import { starsText } from './guest-voice-words'

export function GuestVoiceFixFirst({ read }: Readonly<{ read: GuestVoiceV2Ready }>) {
  const rows = (items: GuestVoiceV2Ready['fixFirst']) => (
    <ol className="divide-y">
      {items.map((item) => (
        <li key={item.issueId}>
          <GuestVoiceIssueTitle
            issueId={item.issueId}
            title={item.title}
            topic={item.topic}
          >
            <span className="font-normal text-muted-foreground">
              {item.statistics.reviewCount} guests ·{' '}
              {item.statistics.mentionedAverage === null
                ? 'Average not available'
                : `${starsText(item.statistics.mentionedAverage)} average`}{' '}
              · {lastMentionedText(item.lastMentionedLocalDate)}
            </span>
          </GuestVoiceIssueTitle>
        </li>
      ))}
    </ol>
  )
  return (
    <GuestVoiceSection
      title="What should we fix first?"
      answer={fixAnswer(read.fixFirst)}
      icon="flag"
      compact={!read.fixFirst.length}
      hint={
        read.fixFirst.length
          ? 'These recurring concerns are worth looking at first.'
          : undefined
      }
      tone="warn"
    >
      {read.fixFirst.length ? (
        rows(read.fixFirst.slice(0, 3))
      ) : (
        <GuestVoiceNothingHere>
          No problem is named in three or more reviews in this period.
        </GuestVoiceNothingHere>
      )}
      {read.fixFirst.length > 3 ||
      read.watch.length ||
      read.remainingCounts.fixFirst ||
      read.remainingCounts.watch ? (
        <GuestVoiceDisclosure
          label={otherConcernsLabel(
            Math.max(0, read.fixFirst.length - 3) +
              read.remainingCounts.fixFirst +
              read.watch.length +
              read.remainingCounts.watch,
          )}
        >
          {rows(read.fixFirst.slice(3))}
          <GuestVoiceOverflow
            count={read.remainingCounts.fixFirst}
            label="more recurring concerns"
          />
          <GuestVoiceWatch items={read.watch} remaining={read.remainingCounts.watch} />
        </GuestVoiceDisclosure>
      ) : null}
    </GuestVoiceSection>
  )
}
