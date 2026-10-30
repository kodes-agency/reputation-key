// Guest voice 2.0, worked out: the reviews that have a current v3 analysis in a window
// (and in the 12 months before it) become the page of the agreed design. A pure function
// of what the store read and what Review counted: it decides what is ranked, what is only
// watched, what guests love and what moved, and which reviews could be quoted for each
// card. It reads no text and calls no model.
import type { GuestVoiceWindowContext } from './guest-voice-v2-check-in'
import type { AiTrendPopulationReview } from '#/contexts/review/application/public-api'
import { buildRatingTrend } from './guest-voice-v2-rating-trend'
import { groupSeriousConcerns, seriousConcerns } from './guest-voice-v2-concerns'
import { GUEST_VOICE_STATISTICS_VERSION } from '../../domain/guest-voice-statistics'
import { REVIEW_ANALYSIS_V3_VERSIONS } from '#/shared/review-analysis-v3'
import type { RatingCounts } from '../aspect-review-evidence'
import type { GuestVoiceV2Ready, Window } from './guest-voice-v2'
import { pickEvidenceCandidates, type EvidenceSlot } from './guest-voice-v2-evidence'
import type { GuestVoiceIssueGroup, GuestVoiceReview } from './guest-voice-v2-facts'
import { inShortLines } from './guest-voice-v2-in-short'
import {
  MAX_FIX_FIRST,
  MAX_GUESTS_LOVE,
  MAX_WATCH,
  countReviews,
  everyTopicRows,
  fixFirstItems,
  guestsLoveItems,
  watchItems,
  whatChangedItems,
  type CountedReviews,
  type SectionInput,
} from './guest-voice-v2-sections'
import { issueSenseKey } from './guest-voice-v2-tally'
import { urgentSection } from './guest-voice-v2-urgent'

/** What Review counted for the window: every review, those with only stars included. */
export type WindowPopulation = Readonly<{
  /** How many of them gave 1, 2, 3, 4 and 5 stars. */
  stars: RatingCounts
  /** Of those, the ones with text. */
  textReviews: number
}>

export type GuestVoiceBuildInput = Readonly<{
  propertyId: string
  window: Window
  startLocalDate: string
  endLocalDate: string
  /** Reviews are still being analysed, so a figure may move and no change is claimed. */
  provisional: boolean
  currentPopulation: readonly AiTrendPopulationReview[]
  population: WindowPopulation
  groups: ReadonlyMap<string, GuestVoiceIssueGroup>
  /** The reviews of the window with a current analysis. */
  current: readonly GuestVoiceReview[]
  /** The same for the 12 months before the window, which a change is measured against. */
  baseline: readonly GuestVoiceReview[]
}>

export type GuestVoiceBuild = Readonly<{
  read: GuestVoiceV2Ready
  evidence: readonly EvidenceSlot[]
}>

export function sectionInput(input: GuestVoiceBuildInput): SectionInput {
  const allReviews = input.population.stars.reduce((sum, count) => sum + count, 0)
  return {
    groups: input.groups,
    current: input.current,
    baseline: input.baseline,
    windowFacts: {
      textReviews: input.current.length,
      allReviews,
      stars: input.population.stars,
      // A change is judged against the 12 months before the window; while any review is
      // still being analysed those months are not whole, so the engine has nothing to
      // compare with and says it does not know.
      baselineReviews: input.provisional ? 0 : input.baseline.length,
    },
  }
}

export function guestVoiceWindowContext(
  build: GuestVoiceBuildInput,
): GuestVoiceWindowContext {
  return {
    window: build.window,
    startLocalDate: build.startLocalDate,
    endLocalDate: build.endLocalDate,
    dataThroughLocalDate: build.endLocalDate,
    provisional: build.provisional,
    basis: {
      textReviewCount: build.population.textReviews,
      starOnlyCount:
        build.population.stars.reduce((sum, count) => sum + count, 0) -
        build.population.textReviews,
      analysedTextReviewCount: build.current.length,
    },
  }
}

/** Reviews that praise a team member by name: one neutral line, never a name or a count per person. */
function staffPraiseCount(reviews: readonly GuestVoiceReview[]): number {
  return reviews.filter((review) =>
    review.mentions.some(
      (mention) =>
        mention.polarity === 'positive' && mention.namesPerson === 'team_member',
    ),
  ).length
}

function quoteSlots(
  section: EvidenceSlot['section'],
  items: readonly Readonly<{ issueId: string }>[],
  sense: 'complaint' | 'praise',
  counted: CountedReviews,
): readonly EvidenceSlot[] {
  return items.map((item) => ({
    section,
    issueId: item.issueId,
    candidates: pickEvidenceCandidates(
      counted.issues.get(issueSenseKey(item.issueId, sense))?.reviews ?? [],
      item.issueId,
      sense,
    ),
  }))
}

export function assembleGuestVoiceV2(input: GuestVoiceBuildInput): GuestVoiceBuild {
  const sections = sectionInput(input)
  const counted = countReviews(sections)
  const allFixFirst = fixFirstItems(sections, counted, Infinity)
  const allGuestsLove = guestsLoveItems(sections, counted, Infinity)
  const allWatch = watchItems(sections, counted, Infinity)
  const fixFirst = allFixFirst.slice(0, MAX_FIX_FIRST)
  const guestsLove = allGuestsLove.slice(0, MAX_GUESTS_LOVE)
  const watch = allWatch.slice(0, MAX_WATCH)
  const concerns = groupSeriousConcerns(input.current, input.groups)
  const whatChanged = input.provisional ? [] : whatChangedItems(sections, counted)
  const urgent = urgentSection(sections, counted, concerns)
  const staffReviews = staffPraiseCount(input.current)
  const read: GuestVoiceV2Ready = {
    status: 'ready',
    checkInVersion: 'guest-voice-check-in-v1',
    ratingTrend: buildRatingTrend(input.currentPopulation, input, input.provisional),
    seriousConcerns: seriousConcerns(concerns, input.provisional),
    sectionTotals: {
      fixFirst: allFixFirst.length,
      guestsLove: allGuestsLove.length,
      watch: allWatch.length,
    },
    remainingCounts: {
      fixFirst: Math.max(0, allFixFirst.length - fixFirst.length),
      guestsLove: Math.max(0, allGuestsLove.length - guestsLove.length),
      watch: Math.max(0, allWatch.length - watch.length),
    },
    readModelVersion: REVIEW_ANALYSIS_V3_VERSIONS.guestVoiceReadModel,
    statisticsVersion: GUEST_VOICE_STATISTICS_VERSION,
    ...guestVoiceWindowContext(input),
    inShort: inShortLines({ fixFirst, guestsLove, whatChanged }),
    urgent: urgent.items,
    ...(urgent.otherCount === 0 ? {} : { urgentOtherCount: urgent.otherCount }),
    fixFirst,
    guestsLove,
    staffPraise:
      staffReviews === 0
        ? null
        : {
            reviewCount: staffReviews,
            inboxHref: `/inbox?propertyId=${input.propertyId}&since=${input.startLocalDate}&until=${input.endLocalDate}`,
          },
    watch,
    whatChanged,
    everyTopic: everyTopicRows(sections),
  }
  return {
    read,
    evidence: [
      ...urgent.evidence,
      ...quoteSlots('fixFirst', fixFirst, 'complaint', counted),
      ...quoteSlots('guestsLove', guestsLove, 'praise', counted),
    ],
  }
}
