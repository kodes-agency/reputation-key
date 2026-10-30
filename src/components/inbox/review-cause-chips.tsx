import { ArrowDown, ArrowUp } from 'lucide-react'
import { Badge, type BadgeVariant } from '#/components/ui/badge'
import { cn } from '#/lib/utils'
import { INBOX_CHIP_STATIC_CLASS } from './inbox-chip'
import { prioritySuggestion, prioritySuggestionHint } from './inbox-priority-view'
import {
  causeLine,
  correctionWord,
  isRemoved,
  matchedLine,
  matchedMentionOrdinals,
  senseOfMention,
  senseWord,
  type MentionSense,
  type ReadyAnalysisV3,
} from './review-cause-view'
import type { ReactNode } from 'react'
import type {
  InboxMentionV3,
  InboxPriority,
} from '#/contexts/inbox/application/public-api'
import type { MatchedIssue } from './use-matched-issue'

/**
 * Direction colour never carries meaning alone: every tinted chip also prints its arrow
 * and the word for its sense. A remark gets no tint and no arrow, because there is no
 * direction to show, and a topic a manager set aside is struck through and says so.
 */
const SENSE_VARIANT: Readonly<Record<MentionSense, BadgeVariant>> = {
  complaint: 'negative',
  praise: 'positive',
  neutral: 'outline',
}

function SenseArrow({ sense }: Readonly<{ sense: MentionSense }>): ReactNode {
  if (sense === 'praise') return <ArrowUp aria-hidden="true" />
  if (sense === 'complaint') return <ArrowDown aria-hidden="true" />
  return null
}

function CauseChip({
  mention,
  matched,
}: Readonly<{ mention: InboxMentionV3; matched: boolean }>): ReactNode {
  const removed = isRemoved(mention)
  const sense = senseOfMention(mention)
  return (
    <Badge
      variant={removed ? 'outline' : SENSE_VARIANT[sense]}
      // A ring, not a colour: the chip keeps its own tone, and the line under the chips
      // says in words which ones matched. A cause can run to six words, so it may wrap.
      className={cn(
        INBOX_CHIP_STATIC_CLASS,
        'max-w-full font-normal whitespace-normal',
        removed && 'text-muted-foreground line-through',
        matched && 'ring-2 ring-ring',
      )}
    >
      {removed ? null : <SenseArrow sense={sense} />}
      {causeLine(mention)} · {senseWord(sense)}
      {matched ? (
        <span className="sr-only"> (matches the issue you followed)</span>
      ) : null}
    </Badge>
  )
}

function CauseChipList({
  mentions,
  matched,
}: Readonly<{
  mentions: readonly InboxMentionV3[]
  matched: ReadonlySet<number>
}>): ReactNode {
  return (
    <ul aria-label="Review topics" className="flex flex-wrap items-center gap-2">
      {mentions.map((mention) => {
        const word = correctionWord(mention)
        return (
          <li
            key={mention.mentionOrdinal}
            className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5"
          >
            <CauseChip mention={mention} matched={matched.has(mention.mentionOrdinal)} />
            {word === null ? null : (
              <span className="text-xs text-muted-foreground">{word}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * What a v3 review is about, in the causes the analysis named: "Air conditioning, not
 * working · Complaint", not the topic alone. A chip is never a target; a manager's word on
 * it ("Not right?") is the control after the list, and a correction shows here at once.
 *
 * As for the v2 chips, the toolbar's Priority control says the level, and one muted line
 * says what the review's signals suggest when a person's level disagrees with them. When
 * the Inbox was opened on an issue, the chips that are that issue wear a ring, and one line
 * says in words which.
 */
export function ReviewCauseChips({
  analysis,
  managerPriority = null,
  matchedIssue = null,
  trailing = null,
}: Readonly<{
  analysis: ReadyAnalysisV3
  /** The level a person set on the item, if any (ADR 0071). */
  managerPriority?: InboxPriority | null
  /** The issue the Inbox was opened on (a Guest voice link), to mark where it is here. */
  matchedIssue?: MatchedIssue | null
  /** What comes after the chips: the way to correct them. */
  trailing?: ReactNode
}>): ReactNode {
  const hint = prioritySuggestionHint(managerPriority, prioritySuggestion(analysis))
  const hintLine = hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null

  // A reading may name no cause at all. An empty list is announced as "Review topics,
  // list, 0 items" and still takes its share of the guest article's gap.
  if (analysis.mentions.length === 0) return hintLine

  const matched = matchedMentionOrdinals(analysis.mentions, matchedIssue)
  const matchedText = matchedLine(analysis.mentions, matched)
  return (
    <div className="flex flex-col gap-2">
      <CauseChipList mentions={analysis.mentions} matched={matched} />
      {matchedText === null ? null : (
        <p className="text-xs text-muted-foreground">{matchedText}</p>
      )}
      {hintLine}
      {trailing}
    </div>
  )
}
