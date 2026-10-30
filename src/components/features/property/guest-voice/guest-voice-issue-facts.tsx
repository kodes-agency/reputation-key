import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import type {
  GuestVoiceWindow,
  IssueStatistics,
} from '#/contexts/ai/application/public-api'
import { ChangeBadge, Figures } from './guest-voice-figures'
import {
  TOO_FEW_FOR_A_TREND,
  averagesSpoken,
  averagesText,
  changePill,
  inReviewsText,
  worthUpToText,
  type ChangeSense,
} from './guest-voice-words'

/**
 * What is known of one problem or strength, counts first: in how many of the reviews
 * with text it is named, what those reviews gave, whether that is moving, and what
 * it could be worth to the average. Shown on a card and again at the top of the drawer.
 */
export function GuestVoiceIssueFacts({
  statistics,
  window,
  sense,
  showWorth = true,
}: Readonly<{
  statistics: IssueStatistics
  window: GuestVoiceWindow
  sense: ChangeSense
  /** A strength has no stars at stake: its gap is no cost. */
  showWorth?: boolean
}>) {
  const pill = changePill(statistics.change, statistics.evidenceLevel, sense)
  const averages = averagesText(statistics)
  const spoken = averagesSpoken(statistics)
  const worth = showWorth ? worthUpToText(statistics, window) : null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span>
          <Figures>{inReviewsText(statistics)}</Figures>
        </span>
        {averages === null ? null : (
          <span>
            <span aria-hidden="true">
              <Figures>{averages}</Figures>
            </span>
            <span className="sr-only">{spoken}</span>
          </span>
        )}
        {pill === null ? <span>{TOO_FEW_FOR_A_TREND}</span> : <ChangeBadge pill={pill} />}
      </p>
      {worth === null ? null : (
        <p className="text-sm text-muted-foreground">
          <Figures>{worth}</Figures>
          {' · '}
          <GlossaryTerm term="worth-up-to">association, not proof</GlossaryTerm>
        </p>
      )}
    </div>
  )
}
