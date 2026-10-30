import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

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
const seam = vi.hoisted(() => ({ method: null as string | null }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
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

vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>()
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { ...actual, getLogger: () => logger }
})

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
import { aiError } from '../domain/errors'

const DASHBOARD_READ: Permission = 'dashboard.read'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000021'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000022'
const REVIEW_ID = '00000000-0000-4000-8000-000000000031'
const ITEM_ID = '00000000-0000-4000-8000-000000000041'
const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-guest-voice-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

const call = (range: string = '90d') =>
  getGuestVoiceV2Fn({ data: { propertyId: PROPERTY_ID, range } } as Parameters<
    typeof getGuestVoiceV2Fn
  >[0])

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    (value) => ({ rejected: false as const, value }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  if (!outcome.rejected) {
    throw new Error(`expected rejection, received ${JSON.stringify(outcome.value)}`)
  }
  return outcome.error
}

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

/** A draft with one Fix first card that could be quoted from one review. */
function draft() {
  return {
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
      evidence: [
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
      ],
      latest: [],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.decide.mockResolvedValue({ allowed: true })
  mocks.readGuestVoiceV2.mockResolvedValue({ status: 'not_v3' })
  mocks.getReviewInboxItemIds.mockResolvedValue(new Map([[REVIEW_ID, ITEM_ID]]))
  mocks.getReviewSnippetsByIds.mockResolvedValue(
    new Map([
      [
        REVIEW_ID,
        { text: 'Lovely room. The air conditioning broke. Fine.', sourceRevision: 1 },
      ],
    ]),
  )
})

describe('getGuestVoiceV2Fn tenant and gate wiring', () => {
  it('is a GET read scoped to the session tenant and one requested property', async () => {
    expect(seam.method).toBe('GET')

    await call('30d')

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: DASHBOARD_READ,
      propertyId: PROPERTY_ID,
    })
    expect(mocks.readGuestVoiceV2).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actor: ACTOR,
      range: '30d',
    })
  })

  it('reads the automatic window for a bookmark that still says all time', async () => {
    await call('all')

    expect(mocks.readGuestVoiceV2).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'auto' }),
    )
  })

  it('authorizes before touching the AI read', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('denied'))

    await rejection(call())

    expect(mocks.readGuestVoiceV2).not.toHaveBeenCalled()
  })

  it('answers a 403 when the use case refuses the reader for the Property', async () => {
    mocks.readGuestVoiceV2.mockRejectedValue(
      aiError('forbidden', 'Property is not readable by this caller'),
    )

    expect(await rejection(call())).toMatchObject({
      _tag: 'AiError',
      code: 'forbidden',
      status: 403,
    })
  })

  it('refuses a range it does not know', async () => {
    await rejection(call('weekly'))

    expect(mocks.readGuestVoiceV2).not.toHaveBeenCalled()
  })
})

describe('getGuestVoiceV2Fn answers', () => {
  it.each(['disabled', 'preparing', 'not_v3'] as const)(
    'passes %s on as it is, reading no review and no Inbox item',
    async (status) => {
      mocks.readGuestVoiceV2.mockResolvedValue({ status })

      await expect(call()).resolves.toEqual({ status })
      expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
      expect(mocks.getReviewSnippetsByIds).not.toHaveBeenCalled()
    },
  )

  it('quotes a card with the review’s words as they stand, under the sentence the analysis cited', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue(draft())

    const page = await call()

    expect(mocks.getReviewInboxItemIds).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, reviewIds: [REVIEW_ID] },
      ACTOR,
    )
    expect(mocks.getReviewSnippetsByIds).toHaveBeenCalledWith(
      [REVIEW_ID],
      ORGANIZATION_ID,
    )
    if (page === undefined || !('fixFirst' in page)) throw new Error('expected the page')
    const quote = page.fixFirst[0]?.quote
    expect(quote).toMatchObject({
      inboxItemId: ITEM_ID,
      reviewedAt: '2026-10-18',
      rating: 2,
      text: 'Lovely room. The air conditioning broke. Fine.',
    })
    expect(
      quote?.sentenceRanges.map(({ start, end }) => quote.text.slice(start, end)),
    ).toEqual(['The air conditioning broke.'])
  })

  // S2: the analysis cited sentence numbers of revision 1. A review edited since is
  // another text, and the same numbers can point at other sentences, so it is not quoted:
  // the card keeps its figures.
  it('quotes nothing from a review edited since the analysis, and still answers the page', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue(draft())
    mocks.getReviewSnippetsByIds.mockResolvedValue(
      new Map([
        [
          REVIEW_ID,
          { text: 'Dreadful room. The staff were rude. Fine.', sourceRevision: 2 },
        ],
      ]),
    )

    const page = await call()

    if (page === undefined || !('fixFirst' in page)) throw new Error('expected the page')
    expect(page.fixFirst[0]?.quote).toBeNull()
    expect(page.fixFirst[0]?.statistics).toEqual(STATISTICS)
  })

  it('quotes nothing for a reader the policy refuses the Inbox, and still answers the page', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue(draft())
    mocks.decide.mockResolvedValue({ allowed: false })

    const page = await call()

    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
    expect(mocks.getReviewSnippetsByIds).not.toHaveBeenCalled()
    if (page === undefined || !('fixFirst' in page)) throw new Error('expected the page')
    expect(page.fixFirst[0]?.quote).toBeNull()
    expect(page.fixFirst[0]?.statistics).toEqual(STATISTICS)
  })

  it('reads no words for a review the reader cannot open', async () => {
    mocks.readGuestVoiceV2.mockResolvedValue(draft())
    mocks.getReviewInboxItemIds.mockResolvedValue(new Map())

    const page = await call()

    expect(mocks.getReviewSnippetsByIds).not.toHaveBeenCalled()
    if (page === undefined || !('fixFirst' in page)) throw new Error('expected the page')
    expect(page.fixFirst[0]?.quote).toBeNull()
  })
})

describe('getGuestVoiceDetailFn', () => {
  const data = {
    propertyId: PROPERTY_ID,
    range: '30d' as const,
    startLocalDate: '2026-10-01',
    endLocalDate: '2026-10-30',
    target: { kind: 'topic' as const, topic: 'cleanliness' as const },
  }
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.headersFromContext.mockResolvedValue(new Headers())
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.readGuestVoiceDetail.mockResolvedValue({ status: 'not_found' })
  })
  it('passes only the session Organization and actor to the dashboard-authorized read', async () => {
    expect(await getGuestVoiceDetailFn({ data })).toEqual({ status: 'not_found' })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledExactlyOnceWith({
      actor: ACTOR,
      action: 'dashboard.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.readGuestVoiceDetail).toHaveBeenCalledExactlyOnceWith({
      ...data,
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
    })
  })
  it('validates targets and real ISO dates, and rejects browser-supplied tenant/actor fields', async () => {
    for (const invalid of [
      { ...data, organizationId: ORGANIZATION_ID },
      { ...data, startLocalDate: '2026-02-30' },
      { ...data, target: { kind: 'issue', issueId: 'bad', sense: 'praise' } },
    ]) {
      await expect(
        getGuestVoiceDetailFn({ data: invalid } as unknown as Parameters<
          typeof getGuestVoiceDetailFn
        >[0]),
      ).rejects.toThrow(/unrecognized_keys|invalid_format/)
    }
    expect(mocks.readGuestVoiceDetail).not.toHaveBeenCalled()
  })
  it('does not resolve any live words for unavailable or stale results', async () => {
    for (const status of ['disabled', 'preparing', 'refresh_required', 'not_found']) {
      mocks.readGuestVoiceDetail.mockResolvedValue({ status })
      expect(await getGuestVoiceDetailFn({ data })).toEqual({ status })
    }
    expect(mocks.getReviewSnippetsByIds).not.toHaveBeenCalled()
  })
  it('resolves concern sentences live and withholds changed or inaccessible words', async () => {
    const pageDraft = draft().draft
    const response = {
      status: 'drafted',
      draft: {
        read: {
          status: 'ready',
          drawer: {
            kind: 'concern',
            target: { kind: 'concern', issueId: null, reason: 'health' },
            title: 'Reported health concerns',
            reason: 'health',
            reviewCount: 1,
            lastReportedLocalDate: '2026-10-18',
            context: {
              window: '30d',
              startLocalDate: data.startLocalDate,
              endLocalDate: data.endLocalDate,
              dataThroughLocalDate: data.endLocalDate,
              provisional: false,
              basis: { textReviewCount: 1, starOnlyCount: 0, analysedTextReviewCount: 1 },
            },
            liveEvidence: [],
            monthlySeries: [],
            matchingReviews: {
              startLocalDate: data.startLocalDate,
              endLocalDate: data.endLocalDate,
              issueId: null,
              sense: null,
            },
          },
        },
        evidence: pageDraft.evidence,
        latest: [],
      },
    }
    mocks.readGuestVoiceDetail.mockResolvedValue(response)
    const result = await getGuestVoiceDetailFn({ data })
    if (result.status !== 'ready' || result.drawer.kind !== 'concern')
      throw new Error('expected concern')
    expect(result.drawer.liveEvidence[0]?.text).toBe(
      'Lovely room. The air conditioning broke. Fine.',
    )
    expect(
      result.drawer.liveEvidence[0]?.sentenceRanges.map((r) =>
        result.drawer.kind === 'concern'
          ? result.drawer.liveEvidence[0]?.text.slice(r.start, r.end)
          : '',
      ),
    ).toEqual(['The air conditioning broke.'])
    mocks.getReviewSnippetsByIds.mockResolvedValue(
      new Map([[REVIEW_ID, { text: 'Changed words.', sourceRevision: 2 }]]),
    )
    const changed = await getGuestVoiceDetailFn({ data })
    expect(changed).toMatchObject({
      status: 'ready',
      drawer: { reviewCount: 1, liveEvidence: [] },
    })
    mocks.getReviewSnippetsByIds.mockClear()
    mocks.decide.mockResolvedValue({ allowed: false })
    expect(await getGuestVoiceDetailFn({ data })).toMatchObject({
      status: 'ready',
      drawer: { reviewCount: 1, liveEvidence: [] },
    })
    expect(mocks.getReviewSnippetsByIds).not.toHaveBeenCalled()
  })

  it('maps the application Property refusal and sanitizes unexpected failures', async () => {
    mocks.readGuestVoiceDetail.mockRejectedValue(aiError('forbidden', 'not granted'))
    await expect(getGuestVoiceDetailFn({ data })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    })
    mocks.readGuestVoiceDetail.mockRejectedValue(new Error('private diagnostic'))
    await expect(getGuestVoiceDetailFn({ data })).rejects.not.toMatchObject({
      message: 'private diagnostic',
    })
  })
})
