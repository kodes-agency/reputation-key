// The hotel in the states a read can be in besides its ordinary one: with an Urgent
// review, and while its history is still being analysed.
import type {
  FixFirstItem,
  GuestVoiceV2Ready,
  IssueStatistics,
} from '#/contexts/ai/application/public-api'
import { issueStatistics } from '#/contexts/ai/application/read-models/issue-statistics'
import { fixtureId, quoteOf } from './guest-voice-fixtures-build'
import { LARGE_READ, LARGE_WINDOW } from './guest-voice-fixtures-large'

export const RAILING_STATISTICS = issueStatistics(LARGE_WINDOW, {
  stars: [0, 1, 0, 0, 0],
  before: 0,
})

export const RAILING_QUOTE = quoteOf({
  id: fixtureId('b', 8),
  rating: 2,
  reviewedAt: '2026-10-26',
  text: 'Lovely room with a view. The balcony railing was loose and our kids were with us. Reception shrugged when we told them.',
  cited: [2],
})

/** The Urgent review of the hotel: a balcony railing that was loose, with children on it. */
export const RAILING_ISSUE: FixFirstItem = {
  issueId: fixtureId('a', 11),
  title: 'Balcony railing',
  answerName: 'Balcony railing',
  lastMentionedLocalDate: '2026-10-29',
  topic: 'safety',
  causes: ['Loose'],
  urgentReason: 'safety',
  statistics: RAILING_STATISTICS,
  quote: RAILING_QUOTE,
}

export const URGENT_READ: GuestVoiceV2Ready = { ...LARGE_READ, urgent: [RAILING_ISSUE] }

/** The engine has not judged a move: reviews are still being analysed. */
function unjudged(statistics: IssueStatistics): IssueStatistics {
  return {
    ...statistics,
    change: 'unknown',
    evidenceLevel:
      statistics.evidenceLevel === 'likely' ? 'early' : statistics.evidenceLevel,
  }
}

/**
 * The same hotel while its history is still being analysed: the figures stand, no
 * change is claimed, and the page says they can still move.
 */
export const PROVISIONAL_READ: GuestVoiceV2Ready = {
  ...LARGE_READ,
  provisional: true,
  inShort: LARGE_READ.inShort.filter((line) => line.kind !== 'change'),
  fixFirst: LARGE_READ.fixFirst.map((item) => ({
    ...item,
    statistics: unjudged(item.statistics),
  })),
  guestsLove: LARGE_READ.guestsLove.map((item) => ({
    ...item,
    statistics: unjudged(item.statistics),
  })),
  whatChanged: [],
  everyTopic: LARGE_READ.everyTopic.map((row) => ({
    ...row,
    statistics: unjudged(row.statistics),
  })),
}
