import { REVIEW_ANALYSIS_V3_VERSIONS } from '#/shared/review-analysis-v3'
import {
  assembleGuestVoiceV2,
  guestVoiceWindowContext,
} from '../read-models/guest-voice-v2-build'
import {
  reviewNamesAPerson,
  type GuestVoiceV2Draft,
} from '../read-models/guest-voice-v2-evidence'
import { reviewVersionKey } from '../read-models/guest-voice-v2-join'
import {
  textReviewsSince,
  windowStart,
  type PopulationRange,
} from '../read-models/guest-voice-v2-population'
import { withSentences } from '../read-models/guest-voice-v2-sentences'
import {
  loadGuestVoiceReadContext,
  type GuestVoiceReadDependencies,
  type GuestVoiceReadInput,
} from '../read-models/guest-voice-read-context'
import {
  groupSeriousConcerns,
  seriousConcerns,
} from '../read-models/guest-voice-v2-concerns'

export type GuestVoiceV2Range = PopulationRange
export type ReadGuestVoiceV2Dependencies = GuestVoiceReadDependencies
export type ReadGuestVoiceV2Input = GuestVoiceReadInput
export type GuestVoiceV2Response =
  | Readonly<{ status: 'disabled' | 'preparing' | 'not_v3' }>
  | Readonly<{ status: 'drafted'; draft: GuestVoiceV2Draft }>

export function createReadGuestVoiceV2(
  deps: ReadGuestVoiceV2Dependencies,
): (input: ReadGuestVoiceV2Input) => Promise<GuestVoiceV2Response> {
  return async (input) => {
    const context = await loadGuestVoiceReadContext(deps, input)
    if (context.status !== 'loaded')
      return {
        status: context.status === 'refresh_required' ? 'preparing' : context.status,
      }
    const { build, choice } = context
    if (choice.enough) {
      const built = assembleGuestVoiceV2(build)
      return {
        status: 'drafted',
        draft: {
          read: built.read,
          evidence: await withSentences(deps.facts, context.scope, built.evidence),
          latest: [],
        },
      }
    }
    const analysed = new Map(build.current.map((r) => [reviewVersionKey(r), r]))
    const latest = [...build.currentPopulation]
      .sort(
        (a, b) =>
          b.localDate.localeCompare(a.localDate) || b.reviewId.localeCompare(a.reviewId),
      )
      .slice(0, 3)
      .map((review) => {
        const found = analysed.get(reviewVersionKey(review))
        return {
          reviewId: review.reviewId,
          reviewedAt: review.localDate,
          rating: review.rating,
          mayShowText:
            review.hasText && found !== undefined && !reviewNamesAPerson(found),
          sourceRevision: review.sourceRevision,
        }
      })
    return {
      status: 'drafted',
      draft: {
        read: {
          status: 'not_enough_reviews',
          readModelVersion: REVIEW_ANALYSIS_V3_VERSIONS.guestVoiceReadModel,
          checkInVersion: 'guest-voice-check-in-v1',
          textReviewCount: textReviewsSince(
            choice.reviews,
            windowStart(build.endLocalDate, '365d'),
          ),
          context: guestVoiceWindowContext(build),
          seriousConcerns: seriousConcerns(
            groupSeriousConcerns(build.current, build.groups),
            build.provisional,
          ),
          allReviewCount: build.currentPopulation.length,
          latestReviewCount: latest.length,
          latestReviews: [],
        },
        evidence: [],
        latest,
      },
    }
  }
}
export type ReadGuestVoiceV2 = ReturnType<typeof createReadGuestVoiceV2>
