// Guest voice 2.0: the read behind the page that replaces today's for a Property whose
// reviews have a v3 analysis. It authorizes the reader, passes the same gate every AI
// read passes, takes Review's count of the Property's reviews, joins it with what the
// analysis says of each, and hands back the page of the agreed design.
//
// The read is a draft: every figure is final, but the guests' own words are not in it.
// It names which reviews could be quoted for each card (`EvidenceSlot`); the delivery
// layer reads those reviews' text through Review, live, and `withLiveEvidence` puts the
// quotes in. Nothing here reads a word of a review, and nothing is stored.
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { REVIEW_ANALYSIS_V3_VERSIONS } from '#/shared/review-analysis-v3'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'
import { resolveAiReadGate } from '../ai-read-gate'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsScope,
} from '../ports/ai-guest-voice-facts.port'
import { mentionRefKey } from '../ports/ai-guest-voice-facts.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { assembleGuestVoiceV2 } from '../read-models/guest-voice-v2-build'
import {
  reviewNamesAPerson,
  type EvidenceSlot,
  type GuestVoiceV2Draft,
  type LatestReviewReference,
} from '../read-models/guest-voice-v2-evidence'
import {
  joinPeriod,
  joinWindows,
  reviewVersionKey,
} from '../read-models/guest-voice-v2-join'
import {
  BASELINE_DAYS,
  choosePopulation,
  textReviewsSince,
  windowStart,
  type PopulationChoice,
} from '../read-models/guest-voice-v2-population'
import { guestVoiceScopes } from '../read-models/guest-voice-v2-scopes'

/** The windows a manager can ask for: Guest voice 2.0 has no "All time". */
const GUEST_VOICE_V2_RANGES = ['auto', '30d', '90d', '180d', '365d'] as const
export type GuestVoiceV2Range = (typeof GUEST_VOICE_V2_RANGES)[number]

function isGuestVoiceV2Range(value: unknown): value is GuestVoiceV2Range {
  return GUEST_VOICE_V2_RANGES.some((candidate) => candidate === value)
}

/** How many of a young Property's latest reviews are listed. */
const LATEST_REVIEWS = 5

export type GuestVoiceV2Response =
  /** AI review analysis is off for this Property: today's page says so. */
  | Readonly<{ status: 'disabled' }>
  /** Review or the analysis cannot answer yet; the page waits rather than print a zero. */
  | Readonly<{ status: 'preparing' }>
  /** The Property has no v3 analysis: today's page is the one to draw. */
  | Readonly<{ status: 'not_v3' }>
  | Readonly<{ status: 'drafted'; draft: GuestVoiceV2Draft }>

export type ReadGuestVoiceV2Dependencies = Readonly<{
  propertyAccess: AiPropertyAccess
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
  calendar: AiPropertyCalendarPort
  facts: AiGuestVoiceFactsPort
  reviewSources: Pick<AiReviewSourcePort, 'readTrendPopulation'>
  nowEpochMillis: () => number
}>

export type ReadGuestVoiceV2Input = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  /** The reader, authorized for the Property before anything is read. */
  actor: AuthContext
  range: GuestVoiceV2Range
}>

type ReadContext = Readonly<{
  scope: GuestVoiceFactsScope
  endLocalDate: string
  choice: PopulationChoice
}>

/** The sentences each candidate cites; a candidate whose are not stored cannot be underlined. */
async function withSentences(
  facts: AiGuestVoiceFactsPort,
  scope: GuestVoiceFactsScope,
  slots: readonly EvidenceSlot[],
): Promise<readonly EvidenceSlot[]> {
  const refs = slots.flatMap((slot) =>
    slot.candidates.map((candidate) => ({
      reviewId: candidate.reviewId,
      sourceRevision: candidate.sourceRevision,
      analysisSequence: candidate.analysisSequence,
      mentionOrdinal: candidate.mentionOrdinal,
    })),
  )
  const sentences = await facts.readMentionSentences(scope, refs)
  return slots.map((slot) => ({
    ...slot,
    candidates: slot.candidates
      .map((candidate) => ({
        ...candidate,
        sentenceNumbers: sentences.get(mentionRefKey(candidate)) ?? [],
      }))
      .filter((candidate) => candidate.sentenceNumbers.length > 0),
  }))
}

async function readPage(
  dependencies: ReadGuestVoiceV2Dependencies,
  input: ReadGuestVoiceV2Input,
  context: ReadContext,
): Promise<GuestVoiceV2Response> {
  const { scope, endLocalDate, choice } = context
  const window = { startLocalDate: choice.startLocalDate, endLocalDate }
  const before = choice.hasBaseline
    ? {
        startLocalDate: addDays(choice.startLocalDate, -BASELINE_DAYS),
        endLocalDate: addDays(choice.startLocalDate, -1),
      }
    : null
  const facts = await dependencies.facts.readFacts(scope, {
    startLocalDate: (before ?? window).startLocalDate,
    endLocalDate,
  })
  if (facts === null || facts.coverage.settledAnalysisCount === 0) {
    return { status: 'preparing' }
  }

  const { now, earlier, provisional } = joinWindows({
    window,
    before,
    population: choice.reviews,
    facts,
  })

  const built = assembleGuestVoiceV2({
    propertyId: input.propertyId,
    window: choice.window,
    startLocalDate: window.startLocalDate,
    endLocalDate,
    provisional,
    population: now.population,
    groups: new Map(facts.groups.map((group) => [group.id, group])),
    current: now.analysed,
    baseline: earlier?.analysed ?? [],
  })
  return {
    status: 'drafted',
    draft: {
      read: built.read,
      evidence: await withSentences(dependencies.facts, scope, built.evidence),
      latest: [],
    },
  }
}

/**
 * A Property with under about 10 reviews with text in 12 months has no patterns to
 * spot: the page says so and shows its latest reviews (decision Q7). A review is shown
 * with its words only when its analysis is in and names no person.
 */
async function readNotEnough(
  dependencies: ReadGuestVoiceV2Dependencies,
  context: ReadContext,
): Promise<GuestVoiceV2Response> {
  const { scope, endLocalDate, choice } = context
  const year = { startLocalDate: windowStart(endLocalDate, '365d'), endLocalDate }
  const facts = await dependencies.facts.readFacts(scope, year)
  const joined = joinPeriod(
    year,
    choice.reviews,
    facts?.reviews ?? [],
    facts?.unavailable ?? [],
  )
  const analysed = new Map(
    joined.analysed.map((review) => [reviewVersionKey(review), review]),
  )
  // Review lists its reviews oldest first.
  const latest: LatestReviewReference[] = choice.reviews
    .filter((review) => review.localDate >= year.startLocalDate)
    .slice(-LATEST_REVIEWS)
    .reverse()
    .map((review) => {
      const found = analysed.get(reviewVersionKey(review))
      return {
        reviewId: review.reviewId,
        reviewedAt: review.localDate,
        rating: review.rating,
        mayShowText: review.hasText && found !== undefined && !reviewNamesAPerson(found),
        sourceRevision: review.sourceRevision,
      }
    })
  return {
    status: 'drafted',
    draft: {
      read: {
        status: 'not_enough_reviews',
        readModelVersion: REVIEW_ANALYSIS_V3_VERSIONS.guestVoiceReadModel,
        textReviewCount: textReviewsSince(choice.reviews, year.startLocalDate),
        latestReviews: [],
      },
      evidence: [],
      latest,
    },
  }
}

export function createReadGuestVoiceV2(
  dependencies: ReadGuestVoiceV2Dependencies,
): (input: ReadGuestVoiceV2Input) => Promise<GuestVoiceV2Response> {
  return async (input) => {
    await requireAiPropertyReadAccess(
      dependencies.propertyAccess,
      input.actor,
      'dashboard.read',
      input,
    )
    if (!isGuestVoiceV2Range(input.range)) {
      throw new TypeError('Guest voice range must be auto, 30d, 90d, 180d or 365d')
    }

    // fallow-ignore-next-line code-duplication
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }

    const endLocalDate = await dependencies.calendar.resolveLocalDate({
      reviewedAtEpochMillis: dependencies.nowEpochMillis(),
      timezone: gate.profile.timezone,
      calendarProfileVersion: 'property-calendar-v1',
    })
    if (endLocalDate === null) return { status: 'preparing' }

    const { facts: scope, population: populationScope } = guestVoiceScopes(
      input,
      gate,
      endLocalDate,
    )
    if (!(await dependencies.facts.hasV3Analyses(scope))) return { status: 'not_v3' }

    const choice = await choosePopulation(
      dependencies.reviewSources,
      populationScope,
      input.range,
    )
    if (choice === null) return { status: 'preparing' }

    const context: ReadContext = { scope, endLocalDate, choice }
    return choice.enough
      ? readPage(dependencies, input, context)
      : readNotEnough(dependencies, context)
  }
}
