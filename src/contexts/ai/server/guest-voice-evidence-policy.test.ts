// The Guest voice server functions quote a review only for a reader the policy lets
// open the Inbox, and answer the page without words otherwise. Every built-in role
// holds `dashboard.read` and `inbox.read` together, so the harness cannot seed a
// refused reader; the policy and the reads behind it are stood in for here.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type { AuthContext } from '#/shared/domain/auth-context'

type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const mocks = vi.hoisted(() => ({
  readGuestVoiceV2: vi.fn(),
  readGuestVoiceDetail: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
  decide: vi.fn(),
  getReviewInboxItemIds: vi.fn(),
  getReviewSnippetsByIds: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        return async (options: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(options.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => new Date('2026-10-30T10:00:00.000Z'),
    aiPublicApi: {
      readGuestVoiceV2: mocks.readGuestVoiceV2,
      readGuestVoiceDetail: mocks.readGuestVoiceDetail,
    },
    inboxPublicApi: { getReviewInboxItemIds: mocks.getReviewInboxItemIds },
    reviewPublicApi: { getReviewSnippetsByIds: mocks.getReviewSnippetsByIds },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionPolicyModule>()
  return {
    ...actual,
    requireExecutionAllowed: mocks.requireExecutionAllowed,
    getExecutionPolicy: () => ({ decide: mocks.decide }),
  }
})

import { getGuestVoiceDetailFn } from './guest-voice-details'
import { getGuestVoiceV2Fn } from './guest-voice-v2'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000021'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000022'
const REVIEW_ID = '00000000-0000-4000-8000-000000000031'
const ITEM_ID = '00000000-0000-4000-8000-000000000041'
const WORDS = 'Lovely room. The air conditioning broke. Fine.'
const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-guest-voice-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

const STATISTICS = {
  reviewCount: 3,
  textReviewCount: 40,
  allReviewCount: 60,
  shareText: '3 of 40',
  sharePercent: null,
  mentionedAverage: 2,
  othersAverage: 4,
  gap: 2,
  upTo: 0.1,
  change: 'unknown',
  evidenceLevel: 'early',
} as const

const EVIDENCE = [
  {
    section: 'fixFirst' as const,
    issueId: 'issue-1',
    candidates: [
      {
        reviewId: REVIEW_ID,
        mentionOrdinal: 0,
        reviewedAt: '2026-10-18',
        rating: 2,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 1,
        sentenceNumbers: [2],
      },
    ],
  },
]

const pageDraft = {
  status: 'drafted' as const,
  draft: {
    read: {
      status: 'ready' as const,
      readModelVersion: 'guest-voice-read-v2' as const,
      statisticsVersion: 'guest-voice-statistics-v2' as const,
      window: '90d' as const,
      startLocalDate: '2026-08-02',
      endLocalDate: '2026-10-30',
      dataThroughLocalDate: '2026-10-30',
      provisional: false,
      basis: { textReviewCount: 40, starOnlyCount: 20 },
      inShort: [],
      urgent: [],
      fixFirst: [
        {
          issueId: 'issue-1',
          title: 'Air conditioning',
          topic: 'facilities_equipment' as const,
          causes: [],
          urgentReason: null,
          statistics: STATISTICS,
        },
      ],
      guestsLove: [],
      staffPraise: null,
      watch: [],
      whatChanged: [],
      everyTopic: [],
    },
    evidence: EVIDENCE,
    latest: [],
  },
}

const DETAIL = {
  propertyId: PROPERTY_ID,
  range: '30d' as const,
  startLocalDate: '2026-10-01',
  endLocalDate: '2026-10-30',
  target: { kind: 'topic' as const, topic: 'cleanliness' as const },
}

const detailDraft = {
  status: 'drafted' as const,
  draft: {
    read: {
      status: 'ready' as const,
      drawer: {
        kind: 'concern' as const,
        target: { kind: 'concern' as const, issueId: null, reason: 'health' as const },
        title: 'Reported health concerns',
        reason: 'health' as const,
        reviewCount: 1,
        lastReportedLocalDate: '2026-10-18',
        context: {
          window: '30d' as const,
          startLocalDate: DETAIL.startLocalDate,
          endLocalDate: DETAIL.endLocalDate,
          dataThroughLocalDate: DETAIL.endLocalDate,
          provisional: false,
          basis: { textReviewCount: 1, starOnlyCount: 0, analysedTextReviewCount: 1 },
        },
        liveEvidence: [],
        monthlySeries: [],
        matchingReviews: {
          startLocalDate: DETAIL.startLocalDate,
          endLocalDate: DETAIL.endLocalDate,
          issueId: null,
          sense: null,
        },
      },
    },
    evidence: EVIDENCE,
    latest: [],
  },
}

const readPage = () =>
  getGuestVoiceV2Fn({ data: { propertyId: PROPERTY_ID, range: '90d' } } as Parameters<
    typeof getGuestVoiceV2Fn
  >[0])

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.decide.mockResolvedValue({ allowed: true })
  mocks.getReviewInboxItemIds.mockResolvedValue(new Map([[REVIEW_ID, ITEM_ID]]))
  mocks.getReviewSnippetsByIds.mockResolvedValue(
    new Map([[REVIEW_ID, { text: WORDS, sourceRevision: 1 }]]),
  )
})

describe('getGuestVoiceV2Fn', () => {
  it('answers preparing as it is, reading no review and no Inbox item', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue({ status: 'preparing' })

    await expect(readPage()).resolves.toEqual({ status: 'preparing' })
    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
    expect(mocks.getReviewSnippetsByIds).not.toHaveBeenCalled()
  })

  it('quotes a card for a reader the policy lets open the Inbox', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue(pageDraft)

    const page = await readPage()

    if (!('fixFirst' in page)) throw new Error('expected the page')
    expect(page.fixFirst[0]?.quote).toMatchObject({ inboxItemId: ITEM_ID, text: WORDS })
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbox.read', propertyId: PROPERTY_ID }),
    )
  })

  it('quotes nothing for a reader the policy refuses the Inbox, and still answers the page', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue(pageDraft)
    mocks.decide.mockResolvedValue({ allowed: false })

    const page = await readPage()

    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
    if (!('fixFirst' in page)) throw new Error('expected the page')
    expect(page.fixFirst[0]?.quote).toBeNull()
    expect(page.fixFirst[0]?.statistics).toEqual(STATISTICS)
  })
})

describe('getGuestVoiceDetailFn', () => {
  it('draws the concern without words for a reader the policy refuses the Inbox', async () => {
    mocks.readGuestVoiceDetail.mockResolvedValue(detailDraft)
    mocks.decide.mockResolvedValue({ allowed: false })

    const result = await getGuestVoiceDetailFn({ data: DETAIL })

    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'ready',
      drawer: { reviewCount: 1, liveEvidence: [] },
    })
  })

  it('draws the concern with the review’s words for a reader who may open the Inbox', async () => {
    mocks.readGuestVoiceDetail.mockResolvedValue(detailDraft)

    const result = await getGuestVoiceDetailFn({ data: DETAIL })

    if (result.status !== 'ready' || result.drawer.kind !== 'concern')
      throw new Error('expected the concern')
    expect(result.drawer.liveEvidence[0]?.text).toBe(WORDS)
  })
})
