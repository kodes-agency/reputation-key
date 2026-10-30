import { vi } from 'vitest'
import { createReadGuestVoiceDetail } from '#/contexts/ai/application/use-cases/read-guest-voice-detail'
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
} from '#/contexts/ai/application/ports/ai-guest-voice-facts.port'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
  StarValue,
} from '#/contexts/ai/application/read-models/guest-voice-v2-facts'
import {
  createReadGuestVoiceV2,
  type GuestVoiceV2Response,
  type ReadGuestVoiceV2Dependencies,
} from '#/contexts/ai/application/use-cases/read-guest-voice-v2'

export const ORGANIZATION_ID = organizationId('11111111-1111-4111-8111-111111111111')
const PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222222')
const ADMIN = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  userId: userId('33333333-3333-4333-8333-333333333333'),
  role: 'AccountAdmin',
})
const NOW = Date.UTC(2026, 7, 20, 3, 0, 0)
export const END = '2026-08-20'
export const AC = 'a0000000-0000-4000-8000-000000000001'

const GROUP: GuestVoiceIssueGroup = {
  id: AC,
  topic: 'facilities_equipment',
  canonicalThing: 'air conditioning',
  displayName: null,
  hidden: false,
}

export function id(sequence: number) {
  return reviewId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`)
}

/** A review as Review counts it. */
export function counted(
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
export function analysed(
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

export function harness(options: Options = {}) {
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
  return { detail, read, facts, readTrendPopulation, readMerchantAuthorization, deps }
}

export const input = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  actor: ADMIN,
  range: 'auto' as const,
}

export function drafted(response: GuestVoiceV2Response) {
  if (response.status !== 'drafted')
    throw new Error(`expected a draft, got ${response.status}`)
  return response.draft
}
