import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { GuestVoiceFactsRead } from '../ports/ai-guest-voice-facts.port'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
  StarValue,
} from '../read-models/guest-voice-v2-facts'
import {
  createPlanGuestVoiceSummary,
  type PlanGuestVoiceSummaryDependencies,
} from './plan-guest-voice-summary'

const ORGANIZATION_ID = organizationId('11111111-1111-4111-8111-111111111111')
const PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222222')
const INPUT = { organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }
const NOW = Date.UTC(2026, 10, 9, 8, 30, 0)
// A Monday that is not the first of its month, then one that is.
const WEEKLY_MONDAY = '2026-11-09'
const FIRST_MONDAY = '2026-11-02'

const AC = 'a0000000-0000-4000-8000-000000000001'
const VIEW = 'a0000000-0000-4000-8000-000000000002'
const STAFF = 'a0000000-0000-4000-8000-000000000003'
const GROUPS: readonly GuestVoiceIssueGroup[] = [
  {
    id: AC,
    topic: 'facilities_equipment',
    canonicalThing: 'air conditioning',
    displayName: null,
    hidden: false,
  },
  {
    id: VIEW,
    topic: 'atmosphere_noise',
    canonicalThing: 'view',
    displayName: null,
    hidden: false,
  },
  {
    id: STAFF,
    topic: 'staff_service',
    canonicalThing: 'front desk',
    displayName: null,
    hidden: false,
  },
]

const id = (sequence: number) =>
  reviewId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`)

type Spec = Readonly<{
  localDate: string
  complaint?: string
  praise?: string
  rating?: StarValue
  urgent?: GuestVoiceReview['urgentReason']
}>

/** Reviews as Review counts them and as the analysis reads them. */
function reviewsOf(specs: readonly Spec[]) {
  const counted = specs.map((spec, index) => ({
    reviewId: id(index + 1),
    sourceRevision: 1,
    analysisSequence: index + 1,
    localDate: spec.localDate,
    hasText: true,
    rating: spec.rating ?? (5 as StarValue),
  }))
  const analysed: GuestVoiceReview[] = specs.map((spec, index) => {
    const mentions: GuestVoiceMention[] = []
    const mention = (issue: string, polarity: 'negative' | 'positive') =>
      mentions.push({
        mentionOrdinal: mentions.length,
        topic: GROUPS.find((group) => group.id === issue)?.topic ?? 'safety',
        polarity,
        strength: 'clear',
        cause: 'not working',
        issueGroupId: issue,
        namesPerson: null,
      })
    if (spec.complaint !== undefined) mention(spec.complaint, 'negative')
    if (spec.praise !== undefined) mention(spec.praise, 'positive')
    return {
      reviewId: id(index + 1),
      sourceEpoch: 7,
      sourceRevision: 1,
      analysisSequence: index + 1,
      localDate: spec.localDate,
      rating: spec.rating ?? 5,
      urgentReason: spec.urgent ?? null,
      namesAPerson: false,
      mentions,
    }
  })
  return { counted, analysed }
}

/** Dates `back` days before the Monday under test. */
const before = (monday: string, back: number) => {
  const date = new Date(`${monday}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - back)
  return date.toISOString().slice(0, 10)
}

/**
 * Twelve older reviews of a hotel whose air conditioning is the top problem (three
 * complaints) and whose front desk guests like, all more than a week before `monday`.
 */
function olderReviews(monday: string): Spec[] {
  return Array.from({ length: 12 }, (_, index) => ({
    localDate: before(monday, 20 + index),
    ...(index < 3 ? { complaint: AC, rating: 2 as StarValue } : {}),
    ...(index >= 3 && index < 8 ? { praise: STAFF } : {}),
  }))
}

type Options = Readonly<{
  monday?: string
  specs?: readonly Spec[]
  capabilities?: readonly string[]
  localDate?: string | null
  hasV3?: boolean
  populationStatus?: 'complete' | 'policy_unavailable' | 'limit_exceeded'
  facts?: Partial<GuestVoiceFactsRead> | null
}>

function harness(options: Options = {}) {
  const monday = options.monday ?? WEEKLY_MONDAY
  const specs = options.specs ?? olderReviews(monday)
  const { counted, analysed } = reviewsOf(specs)
  const readTrendPopulation = vi.fn(async (request: { startLocalDate: string }) => {
    if (options.populationStatus === 'limit_exceeded') {
      // Too full to read two years or a year: the quarter fits.
      return request.startLocalDate <= before(monday, 100)
        ? { status: 'limit_exceeded' as const }
        : { status: 'complete' as const, reviews: counted, hasEvidenceBeforeStart: false }
    }
    if (options.populationStatus === 'policy_unavailable') {
      return { status: 'policy_unavailable' as const }
    }
    return {
      status: 'complete' as const,
      reviews: counted,
      hasEvidenceBeforeStart: false,
    }
  })
  const facts = {
    hasV3Analyses: vi.fn(async () => options.hasV3 ?? true),
    readFacts: vi.fn(
      async (
        _scope: unknown,
        _period: Readonly<{ startLocalDate: string; endLocalDate: string }>,
      ) =>
        options.facts === null
          ? null
          : {
              coverage: {
                settledAnalysisCount: analysed.length,
                expectedAnalysisCount: analysed.length,
                awaitingAnalysisCount: 0,
              },
              reviews: analysed,
              unavailable: [],
              groups: GROUPS,
              ...options.facts,
            },
    ),
    readMentionSentences: vi.fn(async () => new Map<string, readonly number[]>()),
  }
  const plan = createPlanGuestVoiceSummary({
    authorization: {
      readMerchantAuthorization: vi.fn(async () => ({
        state: 'enabled',
        authorizationLineageId: 'lineage-1',
        capabilities: options.capabilities ?? ['review_analysis'],
        authorizedSourceEpoch: 7,
        capabilityEpochs: {
          review_analysis: { epoch: 4 },
          property_trends: { epoch: 9 },
        },
      })),
    } as unknown as PlanGuestVoiceSummaryDependencies['authorization'],
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available',
        profile: { profileVersion: 11, timezone: 'Europe/Sofia' },
      })),
    } as unknown as PlanGuestVoiceSummaryDependencies['processingProfiles'],
    calendar: {
      resolveLocalDate: vi.fn(async () =>
        options.localDate === undefined ? monday : options.localDate,
      ),
    } as unknown as PlanGuestVoiceSummaryDependencies['calendar'],
    facts,
    reviewSources: {
      readTrendPopulation,
    } as unknown as PlanGuestVoiceSummaryDependencies['reviewSources'],
    nowEpochMillis: () => NOW,
  })
  return { plan, facts, readTrendPopulation }
}

describe('planning a Guest voice summary: when there is nothing to send', () => {
  it('skips a Property whose review analysis is not authorized, reading nothing', async () => {
    const { plan, facts, readTrendPopulation } = harness({
      capabilities: ['property_trends'],
    })

    await expect(plan(INPUT)).resolves.toEqual({ status: 'skipped', why: 'disabled' })
    expect(facts.hasV3Analyses).not.toHaveBeenCalled()
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  it('skips a day that is not a Monday on the Property’s calendar', async () => {
    const { plan, facts } = harness({ localDate: '2026-11-10' })

    await expect(plan(INPUT)).resolves.toEqual({ status: 'skipped', why: 'not_monday' })
    expect(facts.hasV3Analyses).not.toHaveBeenCalled()
  })

  it('skips a Property without a v3 analysis: today’s Guest voice has nothing to summarise', async () => {
    const { plan, readTrendPopulation } = harness({ hasV3: false })

    await expect(plan(INPUT)).resolves.toEqual({ status: 'skipped', why: 'not_v3' })
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  it('skips a Property with too few reviews with text to spot patterns', async () => {
    const monday = WEEKLY_MONDAY
    const { plan, facts } = harness({
      specs: olderReviews(monday).slice(0, 6),
    })

    await expect(plan(INPUT)).resolves.toEqual({
      status: 'skipped',
      why: 'not_enough_reviews',
    })
    expect(facts.readFacts).not.toHaveBeenCalled()
  })

  it('waits while the calendar, Review or the analysis cannot answer', async () => {
    await expect(harness({ localDate: null }).plan(INPUT)).resolves.toEqual({
      status: 'skipped',
      why: 'preparing',
    })
    await expect(
      harness({ populationStatus: 'policy_unavailable' }).plan(INPUT),
    ).resolves.toEqual({ status: 'skipped', why: 'preparing' })
    await expect(harness({ facts: null }).plan(INPUT)).resolves.toEqual({
      status: 'skipped',
      why: 'preparing',
    })
    await expect(
      harness({
        facts: {
          coverage: {
            settledAnalysisCount: 0,
            expectedAnalysisCount: 12,
            awaitingAnalysisCount: 12,
          },
        },
      }).plan(INPUT),
    ).resolves.toEqual({ status: 'skipped', why: 'preparing' })
  })

  it('sends nothing in a quiet week: Fix first held, no new issue, no Urgent review', async () => {
    const { plan } = harness()

    await expect(plan(INPUT)).resolves.toEqual({ status: 'quiet' })
  })
})

describe('planning a Guest voice summary: a week with something in it', () => {
  const lastWeek = (back: number) => before(WEEKLY_MONDAY, back)

  it('sends when a second issue entered Fix first, with the page’s three lines as facts', async () => {
    const { plan } = harness({
      specs: [
        ...olderReviews(WEEKLY_MONDAY),
        ...[1, 2, 3].map((back) => ({
          localDate: lastWeek(back),
          complaint: VIEW,
          rating: 2 as StarValue,
        })),
      ],
    })

    const planned = await plan(INPUT)

    expect(planned).toMatchObject({
      status: 'send',
      summaryKind: 'weekly',
      localDate: WEEKLY_MONDAY,
      window: '365d',
      endLocalDate: WEEKLY_MONDAY,
    })
    if (planned.status !== 'send') throw new Error('expected a summary')
    expect(planned.lines.map((line) => line.kind)).toContain('fix_first')
    const [first] = planned.lines
    expect(first).toMatchObject({
      kind: 'fix_first',
      reviewCount: 3,
      textReviewCount: 15,
      change: null,
      polarity: null,
    })
    // Topics, counts and links: no issue name, cause or quote anywhere in the plan.
    expect(JSON.stringify(planned)).not.toMatch(
      /air conditioning|front desk|not working|"view"/,
    )
  })

  it('sends when an issue is new to Watch', async () => {
    const { plan } = harness({
      specs: [
        ...olderReviews(WEEKLY_MONDAY),
        { localDate: lastWeek(2), complaint: VIEW, rating: 2 },
      ],
    })

    await expect(plan(INPUT)).resolves.toMatchObject({
      status: 'send',
      summaryKind: 'weekly',
    })
  })

  it('sends when a review was Urgent this week, though nothing else moved', async () => {
    const { plan } = harness({
      specs: [
        ...olderReviews(WEEKLY_MONDAY),
        { localDate: lastWeek(1), rating: 1, urgent: 'safety' },
      ],
    })

    await expect(plan(INPUT)).resolves.toMatchObject({
      status: 'send',
      summaryKind: 'weekly',
    })
  })

  it('does not call an Urgent review of last month this week’s news', async () => {
    const { plan } = harness({
      specs: [
        ...olderReviews(WEEKLY_MONDAY),
        { localDate: lastWeek(30), rating: 1, urgent: 'health' },
      ],
    })

    await expect(plan(INPUT)).resolves.toEqual({ status: 'quiet' })
  })

  it('does not send a weekly email with nothing to say', async () => {
    // A new issue to Watch (one complaint) in a hotel whose page has no Fix first, no
    // Guests love and no change: the week is not quiet, and there is no line to state.
    const { plan } = harness({
      specs: [
        ...Array.from({ length: 12 }, (_, index) => ({
          localDate: lastWeek(20 + index),
        })),
        { localDate: lastWeek(2), complaint: VIEW, rating: 2 },
      ],
    })

    await expect(plan(INPUT)).resolves.toEqual({ status: 'skipped', why: 'no_lines' })
  })
})

describe('planning a Guest voice summary: the first Monday of the month', () => {
  it('sends the roundup in a quiet week', async () => {
    const { plan } = harness({ monday: FIRST_MONDAY })

    const planned = await plan(INPUT)

    expect(planned).toMatchObject({
      status: 'send',
      summaryKind: 'monthly',
      localDate: FIRST_MONDAY,
    })
  })

  it('sends the roundup even when the page has nothing to name', async () => {
    const { plan } = harness({
      monday: FIRST_MONDAY,
      specs: Array.from({ length: 12 }, (_, index) => ({
        localDate: before(FIRST_MONDAY, 20 + index),
      })),
    })

    await expect(plan(INPUT)).resolves.toMatchObject({
      status: 'send',
      summaryKind: 'monthly',
      lines: [],
    })
  })

  it('still sends nothing for a Property that cannot show patterns yet', async () => {
    const { plan } = harness({
      monday: FIRST_MONDAY,
      specs: olderReviews(FIRST_MONDAY).slice(0, 5),
    })

    await expect(plan(INPUT)).resolves.toEqual({
      status: 'skipped',
      why: 'not_enough_reviews',
    })
  })
})

describe('planning a Guest voice summary: a Property too full to compare', () => {
  it('is never quiet, because there is no last week to compare with', async () => {
    const { plan } = harness({ populationStatus: 'limit_exceeded' })

    await expect(plan(INPUT)).resolves.toMatchObject({ status: 'send' })
  })
})

describe('planning a Guest voice summary: what it reads', () => {
  it('reads the analysis once, back far enough for last week’s page as well as today’s', async () => {
    const { plan, facts } = harness()

    await plan(INPUT)

    expect(facts.readFacts).toHaveBeenCalledTimes(1)
    const [, period] = vi.mocked(facts.readFacts).mock.calls[0] ?? []
    // The window is a year (not enough reviews for a shorter one), its 12 months before it
    // start a week earlier for last week's page: 365 + 364 + 7 days before Monday.
    expect(period).toEqual({
      startLocalDate: before(WEEKLY_MONDAY, 364 + 365 + 7),
      endLocalDate: WEEKLY_MONDAY,
    })
  })

  it('reads no sentence of a review: the plan never asks for evidence', async () => {
    const { plan, facts } = harness()

    await plan(INPUT)

    expect(facts.readMentionSentences).not.toHaveBeenCalled()
  })
})
