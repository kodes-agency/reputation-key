import { describe, expect, it, vi } from 'vitest'
import { createReadGuestVoiceDetail } from './read-guest-voice-detail'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsRead,
  GuestVoiceFactsScope,
  GuestVoiceMentionRef,
} from '../ports/ai-guest-voice-facts.port'
import { mentionRefKey } from '../ports/ai-guest-voice-facts.port'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
  StarValue,
} from '../read-models/guest-voice-v2-facts'
import {
  createReadGuestVoiceV2,
  type GuestVoiceV2Response,
  type ReadGuestVoiceV2Dependencies,
} from './read-guest-voice-v2'

const ORGANIZATION_ID = organizationId('11111111-1111-4111-8111-111111111111')
const PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222222')
const ADMIN = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  userId: userId('33333333-3333-4333-8333-333333333333'),
  role: 'AccountAdmin',
})
const NOW = Date.UTC(2026, 7, 20, 3, 0, 0)
const END = '2026-08-20'
const AC = 'a0000000-0000-4000-8000-000000000001'

const GROUP: GuestVoiceIssueGroup = {
  id: AC,
  topic: 'facilities_equipment',
  canonicalThing: 'air conditioning',
  displayName: null,
  hidden: false,
}

function id(sequence: number) {
  return reviewId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`)
}

/** A review as Review counts it. */
function counted(
  sequence: number,
  localDate: string,
  over: Readonly<{ hasText?: boolean; rating?: StarValue }> = {},
) {
  return Object.freeze({
    reviewId: id(sequence),
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    hasText: over.hasText ?? true,
    rating: over.rating ?? (5 as StarValue),
  })
}

/** The same review as the analysis counts it. */
function analysed(
  sequence: number,
  localDate: string,
  mentions: readonly Partial<GuestVoiceMention>[] = [],
  over: Partial<GuestVoiceReview> = {},
): GuestVoiceReview {
  return {
    reviewId: id(sequence),
    sourceEpoch: 7,
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    rating: 5,
    urgentReason: null,
    namesAPerson: mentions.some((mention) => (mention.namesPerson ?? null) !== null),
    mentions: mentions.map((mention, index) => ({
      mentionOrdinal: index,
      topic: 'facilities_equipment',
      polarity: 'negative',
      strength: 'clear',
      thing: null,
      cause: 'not working',
      issueGroupId: AC,
      namesPerson: null,
      ...mention,
    })),
    ...over,
  }
}

type Options = Readonly<{
  capabilities?: readonly string[]
  localDate?: string | null
  hasV3?: boolean
  /** What the consent was recorded under, where it is not the served contract. */
  consent?: Partial<{
    noticeVersion: string
    noticeDigest: string
    providerDeploymentProfileVersion: string
  }>
  population?: readonly ReturnType<typeof counted>[]
  populationFor?: (request: Readonly<{ startLocalDate: string }>) => unknown
  facts?: Partial<GuestVoiceFactsRead> | null
  sentences?: ReadonlyMap<string, readonly number[]>
  grants?: readonly (typeof PROPERTY_ID)[]
}>

function harness(options: Options = {}) {
  const readMerchantAuthorization = vi.fn(async () => ({
    state: 'enabled',
    authorizationLineageId: 'lineage-1',
    capabilities: options.capabilities ?? ['review_analysis'],
    authorizedSourceEpoch: 7,
    capabilityEpochs: { review_analysis: { epoch: 4 }, property_trends: { epoch: 9 } },
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    providerDeploymentProfileVersion:
      getAiRuntimeCapability('review_analysis').providerDeploymentProfileVersion,
    ...options.consent,
  }))
  const readTrendPopulation = vi.fn(async (request: { startLocalDate: string }) => {
    if (options.populationFor !== undefined) return options.populationFor(request)
    return {
      status: 'complete' as const,
      reviews: options.population ?? [],
      hasEvidenceBeforeStart: false,
    }
  })
  const facts = {
    hasV3Analyses: vi.fn(async () => options.hasV3 ?? true),
    readFacts: vi.fn(async () =>
      options.facts === null
        ? null
        : {
            coverage: {
              settledAnalysisCount: 5,
              expectedAnalysisCount: 5,
              awaitingAnalysisCount: 0,
            },
            reviews: [],
            unavailable: [],
            groups: [GROUP],
            ...options.facts,
          },
    ),
    readMentionSentences: vi.fn(
      async (_scope: GuestVoiceFactsScope, _refs: readonly GuestVoiceMentionRef[]) =>
        options.sentences ?? new Map<string, readonly number[]>(),
    ),
  } satisfies AiGuestVoiceFactsPort
  const deps: ReadGuestVoiceV2Dependencies = {
    propertyAccess: async () => options.grants ?? [],
    authorization: {
      readMerchantAuthorization,
    } as unknown as ReadGuestVoiceV2Dependencies['authorization'],
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available',
        profile: { profileVersion: 11, timezone: 'Asia/Tokyo' },
      })),
    } as unknown as ReadGuestVoiceV2Dependencies['processingProfiles'],
    calendar: {
      resolveLocalDate: vi.fn(async () =>
        options.localDate === undefined ? END : options.localDate,
      ),
    } as unknown as ReadGuestVoiceV2Dependencies['calendar'],
    facts,
    reviewSources: {
      readTrendPopulation,
    } as unknown as ReadGuestVoiceV2Dependencies['reviewSources'],
    nowEpochMillis: () => NOW,
  }
  const read = createReadGuestVoiceV2(deps)
  const detail = createReadGuestVoiceDetail(deps)
  return { detail, read, facts, readTrendPopulation, readMerchantAuthorization }
}

const input = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  actor: ADMIN,
  range: 'auto' as const,
}

function drafted(response: GuestVoiceV2Response) {
  if (response.status !== 'drafted')
    throw new Error(`expected a draft, got ${response.status}`)
  return response.draft
}

describe('readGuestVoiceV2 authorization and gates', () => {
  const forbidden = { _tag: 'AiError', code: 'forbidden' }

  it('refuses a manager with no grant on the Property before any AI state is read', async () => {
    const { read, facts, readMerchantAuthorization } = harness({
      grants: [propertyId('22222222-2222-4222-8222-222222222223')],
    })
    const manager = buildTestAuthContext({
      organizationId: ORGANIZATION_ID,
      role: 'PropertyManager',
    })

    await expect(read({ ...input, actor: manager })).rejects.toMatchObject(forbidden)
    expect(readMerchantAuthorization).not.toHaveBeenCalled()
    expect(facts.hasV3Analyses).not.toHaveBeenCalled()
  })

  it('refuses a reader who belongs to another Organization', async () => {
    const { read, facts } = harness()
    const foreign = buildTestAuthContext({
      organizationId: organizationId('11111111-1111-4111-8111-111111111112'),
      role: 'AccountAdmin',
    })

    await expect(read({ ...input, actor: foreign })).rejects.toMatchObject(forbidden)
    expect(facts.hasV3Analyses).not.toHaveBeenCalled()
  })

  it('refuses a range the page does not offer', async () => {
    const { read } = harness()

    await expect(
      read({ ...input, range: 'all' as unknown as typeof input.range }),
    ).rejects.toThrow(TypeError)
  })

  it('answers disabled, reading no data, when review analysis is not authorized', async () => {
    const { read, facts, readTrendPopulation } = harness({
      capabilities: ['property_trends'],
    })

    await expect(read(input)).resolves.toEqual({ status: 'disabled' })
    expect(facts.hasV3Analyses).not.toHaveBeenCalled()
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  // The switch-on (2026-10-30): a consent recorded before it lapses at the deploy. Nothing is
  // analysed for the Property until an AccountAdmin confirms the served notice, so Guest voice
  // says AI is off (and the AI settings are where it is confirmed), not "being prepared".
  it.each([
    [
      'a notice no longer in force',
      { noticeVersion: 'merchant-ai-notice-2026-10-17.v1' },
    ],
    ['a digest that is not the notice’s', { noticeDigest: 'f'.repeat(64) }],
    [
      'the deployment profile that was replaced',
      { providerDeploymentProfileVersion: 'private-beta-global-v1' },
    ],
  ])(
    'answers disabled, reading no data, for a consent recorded under %s',
    async (_name, consent) => {
      const { read, facts, readTrendPopulation } = harness({ consent })

      await expect(read(input)).resolves.toEqual({ status: 'disabled' })
      expect(facts.hasV3Analyses).not.toHaveBeenCalled()
      expect(readTrendPopulation).not.toHaveBeenCalled()
    },
  )

  it('answers not_v3, reading no reviews, for a Property with no v3 analysis', async () => {
    const { read, facts, readTrendPopulation } = harness({ hasV3: false })

    await expect(read(input)).resolves.toEqual({ status: 'not_v3' })
    expect(facts.readFacts).not.toHaveBeenCalled()
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  it('is preparing while the Property’s calendar, Review or the analysis cannot answer', async () => {
    await expect(harness({ localDate: null }).read(input)).resolves.toEqual({
      status: 'preparing',
    })
    await expect(
      harness({ populationFor: () => ({ status: 'policy_unavailable' }) }).read(input),
    ).resolves.toEqual({ status: 'preparing' })
    await expect(
      harness({
        population: Array.from({ length: 12 }, (_, i) => counted(i + 1, '2026-08-10')),
        facts: null,
      }).read(input),
    ).resolves.toEqual({ status: 'preparing' })
    await expect(
      harness({
        population: Array.from({ length: 12 }, (_, i) => counted(i + 1, '2026-08-10')),
        facts: {
          coverage: {
            settledAnalysisCount: 0,
            expectedAnalysisCount: 5,
            awaitingAnalysisCount: 5,
          },
        },
      }).read(input),
    ).resolves.toEqual({ status: 'preparing' })
  })
})

describe('readGuestVoiceV2 the page', () => {
  // Sixty-five reviews with text in the last 30 days: the first window holds enough.
  const population = Array.from({ length: 65 }, (_, i) =>
    counted(i + 1, '2026-08-10', { rating: i < 5 ? 2 : 5 }),
  )
  const reviews = population.map((review) =>
    analysed(
      review.analysisSequence,
      review.localDate,
      review.analysisSequence <= 5 ? [{}] : [],
      { rating: review.rating },
    ),
  )

  it('chooses the window itself and counts what the analysis says of the reviews Review counted', async () => {
    const { read, readTrendPopulation, facts } = harness({
      population,
      facts: { reviews },
      sentences: new Map(
        [1, 2, 3, 4, 5].map((n) => [
          mentionRefKey({ reviewId: id(n), mentionOrdinal: 0 }),
          [2],
        ]),
      ),
    })

    const draft = drafted(await read(input))

    expect(draft.read).toMatchObject({
      status: 'ready',
      window: '30d',
      endLocalDate: END,
      startLocalDate: '2026-07-22',
      provisional: false,
      basis: { textReviewCount: 65, starOnlyCount: 0 },
    })
    // The 12 months before the window are read with it: one read of two years.
    expect(readTrendPopulation).toHaveBeenCalledTimes(1)
    expect(readTrendPopulation).toHaveBeenCalledWith(
      expect.objectContaining({ startLocalDate: '2024-08-21', endLocalDate: END }),
    )
    expect(facts.readFacts).toHaveBeenCalledWith(expect.anything(), {
      startLocalDate: '2025-07-22',
      endLocalDate: END,
    })
    if (draft.read.status !== 'ready') throw new Error('expected a ready page')
    expect(draft.read.fixFirst).toHaveLength(1)
    expect(draft.read.fixFirst[0]).toMatchObject({
      issueId: AC,
      title: 'Air conditioning — not working',
      statistics: { reviewCount: 5, textReviewCount: 65 },
    })
  })

  it('reads the sentences each candidate quote cites, and drops one whose are not stored', async () => {
    const { read, facts } = harness({
      population,
      facts: { reviews },
      sentences: new Map([
        [mentionRefKey({ reviewId: id(1), mentionOrdinal: 0 }), [1, 3]],
        [mentionRefKey({ reviewId: id(2), mentionOrdinal: 0 }), []],
      ]),
    })

    const draft = drafted(await read(input))

    expect(facts.readMentionSentences).toHaveBeenCalledTimes(1)
    const asked = vi.mocked(facts.readMentionSentences).mock.calls[0]
    expect(asked?.[1]).toEqual(
      expect.arrayContaining([
        { reviewId: id(1), sourceRevision: 1, analysisSequence: 1, mentionOrdinal: 0 },
      ]),
    )
    const slot = draft.evidence.find((entry) => entry.section === 'fixFirst')
    expect(slot?.candidates.map((c) => [c.reviewId, c.sentenceNumbers])).toEqual([
      [id(1), [1, 3]],
    ])
  })

  it('does not count an analysis of a review Review no longer holds in that version', async () => {
    const stale = analysed(1, '2026-08-10', [{}, {}])
    const { read } = harness({
      population: population.slice(1),
      facts: { reviews: [stale, ...reviews.slice(1)] },
    })

    const draft = drafted(await read(input))

    if (draft.read.status !== 'ready') throw new Error('expected a ready page')
    expect(draft.read.basis.textReviewCount).toBe(64)
    expect(draft.read.fixFirst[0]?.statistics.reviewCount).toBe(4)
  })

  it('makes the figures provisional while a review with text still awaits its analysis', async () => {
    const { read } = harness({
      population,
      facts: { reviews: reviews.slice(1) },
    })

    const draft = drafted(await read(input))

    if (draft.read.status !== 'ready') throw new Error('expected a ready page')
    expect(draft.read.provisional).toBe(true)
    expect(draft.read.whatChanged).toEqual([])
  })

  it('makes the figures provisional while the Property’s analysis is behind', async () => {
    const { read } = harness({
      population,
      facts: {
        reviews,
        coverage: {
          settledAnalysisCount: 60,
          expectedAnalysisCount: 65,
          awaitingAnalysisCount: 5,
        },
      },
    })

    const draft = drafted(await read(input))

    expect(draft.read.status === 'ready' && draft.read.provisional).toBe(true)
  })

  it('reads the window the manager asked for with the 12 months before it', async () => {
    const { read, readTrendPopulation, facts } = harness({
      population,
      facts: { reviews },
    })

    const draft = drafted(await read({ ...input, range: '90d' }))

    expect(draft.read.status === 'ready' && draft.read.window).toBe('90d')
    expect(readTrendPopulation).toHaveBeenCalledWith(
      expect.objectContaining({ startLocalDate: '2025-05-23' }),
    )
    expect(facts.readFacts).toHaveBeenCalledWith(expect.anything(), {
      startLocalDate: '2025-05-23',
      endLocalDate: END,
    })
  })

  it('claims no change when there are too many reviews to read two years, and reads one', async () => {
    const { read, readTrendPopulation, facts } = harness({
      population,
      facts: { reviews },
      populationFor: (request) =>
        request.startLocalDate < '2025-08-21'
          ? { status: 'limit_exceeded' }
          : { status: 'complete', reviews: population, hasEvidenceBeforeStart: false },
    })

    const draft = drafted(await read(input))

    expect(readTrendPopulation).toHaveBeenCalledTimes(2)
    expect(facts.readFacts).toHaveBeenCalledWith(expect.anything(), {
      startLocalDate: '2025-09-01',
      endLocalDate: END,
    })
    expect(draft.read.status === 'ready' && draft.read.whatChanged).toEqual([])
  })

  it('answers preparing when even the window alone is too full to read', async () => {
    const { read } = harness({ populationFor: () => ({ status: 'limit_exceeded' }) })

    await expect(read(input)).resolves.toEqual({ status: 'preparing' })
  })
})

describe('readGuestVoiceV2 a Property too young for patterns', () => {
  // Review lists its reviews oldest first.
  const few = [
    counted(4, '2026-08-15', { rating: 5 }),
    counted(3, '2026-08-16', { rating: 2 }),
    counted(2, '2026-08-17', { rating: 4, hasText: false }),
    counted(1, '2026-08-18', { rating: 5 }),
  ]

  it('says how many reviews with text there are, and lists the latest, newest first', async () => {
    const { read } = harness({
      population: few,
      facts: {
        reviews: [
          analysed(1, '2026-08-18', [{ polarity: 'positive' }]),
          analysed(3, '2026-08-16', [{ namesPerson: 'team_member' }]),
        ],
      },
    })

    const draft = drafted(await read(input))

    expect(draft.read).toMatchObject({
      status: 'not_enough_reviews',
      readModelVersion: 'guest-voice-read-v2',
      textReviewCount: 3,
      latestReviews: [],
    })
    // Newest first. Words only for the one whose analysis is in and names nobody: one has
    // only stars, one names a team member, and one is not analysed yet.
    // Each carries the revision it was counted at, which the quote is checked against.
    expect(draft.latest).toEqual([
      {
        reviewId: id(1),
        reviewedAt: '2026-08-18',
        rating: 5,
        mayShowText: true,
        sourceRevision: 1,
      },
      {
        reviewId: id(2),
        reviewedAt: '2026-08-17',
        rating: 4,
        mayShowText: false,
        sourceRevision: 1,
      },
      {
        reviewId: id(3),
        reviewedAt: '2026-08-16',
        rating: 2,
        mayShowText: false,
        sourceRevision: 1,
      },
    ])
  })

  it('lists no words of a review whose name a manager set aside with its mention', async () => {
    const { read } = harness({
      population: few,
      facts: {
        reviews: [
          // The mention that named a team member is gone from the mentions left, but the
          // review's text still holds the name: the flag stands.
          analysed(1, '2026-08-18', [{ polarity: 'positive' }], { namesAPerson: true }),
          analysed(3, '2026-08-16', [{ polarity: 'negative' }]),
        ],
      },
    })

    const draft = drafted(await read(input))

    expect(draft.latest.map((review) => [review.reviewId, review.mayShowText])).toEqual([
      [id(1), false],
      [id(2), false],
      [id(3), true],
    ])
  })

  it('applies the same rule to a window the manager chose', async () => {
    const { read, facts } = harness({ population: few, facts: { reviews: [] } })

    const draft = drafted(await read({ ...input, range: '30d' }))

    expect(draft.read.status).toBe('not_enough_reviews')
    expect(facts.readMentionSentences).not.toHaveBeenCalled()
  })
})

describe('readGuestVoiceDetail shares the live page context', () => {
  const detailInput = {
    ...input,
    range: '30d' as const,
    startLocalDate: '2026-07-22',
    endLocalDate: END,
    target: { kind: 'issue' as const, issueId: AC, sense: 'complaint' as const },
  }
  const population = [counted(1, '2026-08-18')]
  const reviews = [analysed(1, '2026-08-18', [{}], { urgentReason: 'health' })]

  it('authorizes a direct application caller before reading any state', async () => {
    const { detail, readMerchantAuthorization } = harness()
    const foreign = buildTestAuthContext({
      organizationId: organizationId('foreign'),
      role: 'AccountAdmin',
    })
    await expect(detail({ ...detailInput, actor: foreign })).rejects.toMatchObject({
      _tag: 'AiError',
      code: 'forbidden',
    })
    expect(readMerchantAuthorization).not.toHaveBeenCalled()
  })
  it.each([
    { startLocalDate: '2026-02-30' },
    { endLocalDate: '2026-07-21' },
    { startLocalDate: '2025-07-21' },
    { startLocalDate: '2026-07-23' },
    { endLocalDate: '2026-08-19' },
  ])('requires an actual current permitted window (%s)', async (bounds) => {
    const { detail, facts } = harness({ population, facts: { reviews } })
    expect(await detail({ ...detailInput, ...bounds })).toEqual({
      status: 'refresh_required',
    })
    expect(facts.readFacts).not.toHaveBeenCalled()
    expect(facts.readMentionSentences).not.toHaveBeenCalled()
  })
  it('returns a content-free draft and batches sentence pointers for a small-state concern', async () => {
    const { detail, facts } = harness({
      population,
      facts: { reviews },
      sentences: new Map([[`${id(1)}:0`, [2]]]),
    })
    const result = await detail({
      ...detailInput,
      target: { kind: 'concern', issueId: AC, reason: 'health' },
    })
    if (result.status !== 'drafted') throw new Error('expected detail draft')
    expect(result.draft.read.drawer).toMatchObject({
      kind: 'concern',
      reviewCount: 1,
      lastReportedLocalDate: '2026-08-18',
      liveEvidence: [],
    })
    expect(result.draft.evidence[0]?.candidates[0]?.sentenceNumbers).toEqual([2])
    expect(facts.readMentionSentences).toHaveBeenCalledTimes(1)
  })
  it('maps unknown targets to not_found, and gate/refusal outcomes without fake sheets', async () => {
    const missing = harness({ population, facts: { reviews } })
    expect(
      await missing.detail({
        ...detailInput,
        target: {
          kind: 'issue',
          issueId: 'a0000000-0000-4000-8000-000000000002',
          sense: 'praise',
        },
      }),
    ).toEqual({ status: 'not_found' })
    expect(await harness({ capabilities: [] }).detail(detailInput)).toEqual({
      status: 'disabled',
    })
    expect(await harness({ population, facts: null }).detail(detailInput)).toEqual({
      status: 'preparing',
    })
    expect(await harness({ hasV3: false }).detail(detailInput)).toEqual({
      status: 'preparing',
    })
  })
  it('validates an auto fallback against the chosen bounded 90-day window', async () => {
    const { detail } = harness({
      populationFor: (request) =>
        request.startLocalDate < '2026-05-23'
          ? { status: 'limit_exceeded' }
          : { status: 'complete', reviews: population },
      facts: { reviews },
    })
    const result = await detail({
      ...detailInput,
      range: 'auto',
      startLocalDate: '2026-05-23',
    })
    expect(result.status).toBe('drafted')
  })
  it('keeps the year eligibility count but scopes small-state concerns, latest and basis to the explicit range', async () => {
    const { read } = harness({
      population: [counted(1, '2026-08-18'), counted(2, '2026-01-01')],
      facts: {
        reviews: [
          ...reviews,
          analysed(2, '2026-01-01', [{}], { urgentReason: 'safety' }),
        ],
      },
    })
    const draft = drafted(await read({ ...input, range: '30d' }))
    expect(draft.read).toMatchObject({
      status: 'not_enough_reviews',
      textReviewCount: 2,
      allReviewCount: 1,
      latestReviewCount: 1,
      context: {
        startLocalDate: '2026-07-22',
        basis: { textReviewCount: 1, analysedTextReviewCount: 1 },
      },
      seriousConcerns: { groupCount: 1, reviewCount: 1, coverage: 'complete' },
    })
    expect(draft.latest.map((r) => r.reviewId)).toEqual([id(1)])
  })
  it('returns preparing instead of a quiet zero when a small-state facts read fails', async () => {
    expect(await harness({ population, facts: null }).read(input)).toEqual({
      status: 'preparing',
    })
  })
})

describe('bounded explicit small-state eligibility', () => {
  it('reads the year when the initial bounded range has too few comments to establish eligibility', async () => {
    const reviews = [analysed(1, '2026-08-18', [{}]), analysed(2, '2026-01-01')]
    const { read, readTrendPopulation } = harness({
      populationFor: (request) =>
        request.startLocalDate === '2025-07-22'
          ? { status: 'limit_exceeded' }
          : {
              status: 'complete',
              reviews:
                request.startLocalDate === '2026-07-22'
                  ? [counted(1, '2026-08-18')]
                  : [counted(2, '2026-01-01'), counted(1, '2026-08-18')],
            },
      facts: { reviews },
    })
    const draft = drafted(await read({ ...input, range: '30d' }))
    expect(readTrendPopulation).toHaveBeenCalledTimes(3)
    expect(readTrendPopulation.mock.calls.map(([r]) => r.startLocalDate)).toEqual([
      '2025-07-22',
      '2026-07-22',
      '2025-08-21',
    ])
    expect(draft.read).toMatchObject({
      status: 'not_enough_reviews',
      textReviewCount: 2,
      allReviewCount: 1,
      context: { basis: { textReviewCount: 1 } },
    })
  })
  it('refuses to invent a year count when that bounded eligibility read also exceeds the ceiling', async () => {
    const { read } = harness({
      populationFor: (request) =>
        request.startLocalDate === '2026-07-22'
          ? { status: 'complete', reviews: [] }
          : { status: 'limit_exceeded' },
    })
    expect(await read({ ...input, range: '30d' })).toEqual({ status: 'preparing' })
  })
})

describe('bounded high-volume check-in reads', () => {
  it.each([128, 20_000])(
    'joins only the chosen Review population from %i synthetic reviews',
    async (total) => {
      const population = Array.from({ length: total }, (_, n) =>
        counted(n + 1, n < (total === 128 ? 96 : 5_000) ? '2026-08-01' : '2026-01-01'),
      )
      const analyses = population.map((r, n) => analysed(n + 1, r.localDate, [{}]))
      const { read, readTrendPopulation } = harness({
        populationFor: (request) => {
          const here = population.filter((r) => r.localDate >= request.startLocalDate)
          return here.length >= 10_001
            ? { status: 'limit_exceeded' }
            : { status: 'complete', reviews: here }
        },
        facts: {
          reviews: analyses,
          coverage: {
            settledAnalysisCount: total,
            expectedAnalysisCount: total,
            awaitingAnalysisCount: 0,
          },
        },
      })
      const draft = drafted(await read(input))
      if (draft.read.status !== 'ready') throw new Error('expected ready')
      expect(draft.read.basis).toMatchObject({
        textReviewCount: total === 128 ? 96 : 5_000,
        analysedTextReviewCount: total === 128 ? 96 : 5_000,
      })
      expect(draft.read.ratingTrend.months.reduce((n, m) => n + m.reviewCount, 0)).toBe(
        total === 128 ? 96 : 5_000,
      )
      expect(readTrendPopulation).toHaveBeenCalledTimes(total === 128 ? 1 : 3)
      expect(draft.read.window).toBe(total === 128 ? '30d' : '90d')
    },
  )
})

describe('calendar history never clips the selected rolling year', () => {
  it('retains the first selected day when the year fallback starts before the oldest calendar month', async () => {
    const population = [
      counted(1, '2025-08-21'),
      ...Array.from({ length: 9 }, (_, n) => counted(n + 2, '2026-08-01')),
    ]
    const reviews = population.map((r, n) =>
      analysed(n + 1, r.localDate, [{}], { urgentReason: n === 0 ? 'health' : null }),
    )
    const { read, facts } = harness({
      populationFor: (request) =>
        request.startLocalDate < '2025-08-21'
          ? { status: 'limit_exceeded' }
          : { status: 'complete', reviews: population },
      facts: { reviews },
    })
    const draft = drafted(await read({ ...input, range: '365d' }))
    expect(facts.readFacts).toHaveBeenCalledWith(expect.anything(), {
      startLocalDate: '2025-08-21',
      endLocalDate: END,
    })
    expect(draft.read).toMatchObject({
      status: 'ready',
      provisional: false,
      basis: { textReviewCount: 10, analysedTextReviewCount: 10 },
      seriousConcerns: { groupCount: 1, reviewCount: 1 },
    })
  })
})
