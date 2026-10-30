import type { FixFirstItem } from '#/contexts/ai/application/public-api'
import { GuestVoiceCauses } from './guest-voice-causes'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceIssueActions } from './guest-voice-issue-actions'
import { GuestVoiceIssueFacts } from './guest-voice-issue-facts'
import { GuestVoiceIssueTitle } from './guest-voice-issue-title'
import { GuestVoiceQuote } from './guest-voice-quote'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'

function FixFirstCard({ item, rank }: Readonly<{ item: FixFirstItem; rank: number }>) {
  const { propertyId, window } = useGuestVoice()
  return (
    <li>
      <article className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 rounded-xl border bg-card p-4 md:p-5">
        <span
          aria-hidden="true"
          className="pt-0.5 text-base font-semibold text-muted-foreground tabular-nums"
        >
          {rank}
        </span>
        <div
          className={
            item.quote == null
              ? 'flex min-w-0 flex-col gap-3'
              : 'grid min-w-0 gap-3 @3xl:grid-cols-[minmax(0,1fr)_22rem] @3xl:gap-x-8'
          }
        >
          <div className="flex min-w-0 flex-col gap-3 @3xl:col-start-1 @3xl:row-start-1">
            <GuestVoiceIssueTitle
              issueId={item.issueId}
              title={item.title}
              topic={item.topic}
            />
            <GuestVoiceIssueFacts
              statistics={item.statistics}
              window={window}
              sense="complaint"
            />
            <GuestVoiceCauses
              causes={item.causes.map((cause) => ({ cause }))}
              label={`Causes of ${item.title}`}
            />
          </div>
          {item.quote == null ? null : (
            <div className="min-w-0 @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1">
              <GuestVoiceQuote
                evidence={item.quote}
                sense="complaint"
                propertyId={propertyId}
              />
            </div>
          )}
          <div className="@3xl:col-start-1 @3xl:row-start-2">
            <GuestVoiceIssueActions
              issueId={item.issueId}
              reviewCount={item.statistics.reviewCount}
            />
          </div>
        </div>
      </article>
    </li>
  )
}

/**
 * The problems that need fixing first, the one with the most stars at stake on top.
 * Only a problem named in three or more reviews is ranked here; fewer is on the Watch
 * list, and an Urgent review is above the page.
 */
export function GuestVoiceFixFirst({
  items,
}: Readonly<{ items: readonly FixFirstItem[] }>) {
  return (
    <GuestVoiceSection
      title="Fix first"
      hint="Ranked by how much each problem could be costing your rating"
    >
      {items.length === 0 ? (
        <GuestVoiceNothingHere>
          No problem is named in three or more reviews in this period.
        </GuestVoiceNothingHere>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((item, index) => (
            <FixFirstCard key={item.issueId} item={item} rank={index + 1} />
          ))}
        </ol>
      )}
    </GuestVoiceSection>
  )
}
