import { describe, it, expect, vi } from 'vitest'
import { emptyLookupPorts } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import type { AiReviewInsightsPort } from '#/contexts/reputation/inbox/ai-review-insights.port.server'
import { reviewId, feedbackId } from '#/shared/domain/ids'
import {
  ORG_A,
  PROP_A,
  USER_A,
  db,
  createInboxRepository,
  type AttentionLookup,
  setManagerPriority,
  makeInboxItem,
  useInboxRepositoryDb,
} from './inbox-repository.test-fixtures'

useInboxRepositoryDb()

describe('inbox repository — live content lookup (BQC-1.2)', () => {
  const repo = createInboxRepository(db, emptyLookupPorts)

  it('enriches the urgent and high suggestions from a page-bounded current analysis', async () => {
    const urgentSourceId = reviewId(crypto.randomUUID())
    const highSourceId = reviewId(crypto.randomUUID())
    const otherSourceId = reviewId(crypto.randomUUID())
    for (const sourceId of [urgentSourceId, highSourceId, otherSourceId]) {
      await repo.seedItem(makeInboxItem({ sourceId }))
    }
    const findCurrentReviewIdsByAttention = vi.fn(async (input: AttentionLookup) =>
      input.attention.includes('urgent') ? [urgentSourceId] : [highSourceId],
    )
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const enrichedRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const result = await enrichedRepo.findFilteredPaginated({}, ORG_A, undefined, 50)

    for (const attention of [['urgent'], ['high']]) {
      expect(findCurrentReviewIdsByAttention).toHaveBeenCalledWith({
        organizationId: ORG_A,
        propertyIds: [PROP_A],
        reviewIds: expect.arrayContaining([urgentSourceId, highSourceId, otherSourceId]),
        attention,
      })
    }
    const attentionOf = (sourceId: string) =>
      result.items.find((item) => item.sourceId === sourceId)?.attention
    expect(attentionOf(urgentSourceId)).toBe('urgent')
    expect(attentionOf(highSourceId)).toBe('high')
    expect(attentionOf(otherSourceId)).toBe(null)
  })

  it('skips the suggestion for a row a manager set a level on', async () => {
    const setSourceId = reviewId(crypto.randomUUID())
    const openSourceId = reviewId(crypto.randomUUID())
    const set = await repo.seedItem(makeInboxItem({ sourceId: setSourceId }))
    await repo.seedItem(makeInboxItem({ sourceId: openSourceId }))
    await setManagerPriority(set.id, 'low')
    const findCurrentReviewIdsByAttention = vi.fn(async () => [setSourceId])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const enrichedRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const result = await enrichedRepo.findFilteredPaginated({}, ORG_A, undefined, 50)

    // Only the row with no level is asked about: a set level wins anyway.
    for (const [input] of findCurrentReviewIdsByAttention.mock.calls as unknown as [
      { reviewIds: readonly string[] },
    ][]) {
      expect(input.reviewIds).toEqual([openSourceId])
    }
    const row = result.items.find((item) => item.sourceId === setSourceId)
    expect(row).toMatchObject({
      managerPriority: 'low',
      managerPrioritySetBy: USER_A,
      attention: null,
    })
  })

  it('the Priority filter asks the tenant and property-scoped AI projection for the suggestion', async () => {
    const srcMatch = reviewId(crypto.randomUUID())
    const srcOther = reviewId(crypto.randomUUID())
    await repo.seedItem(makeInboxItem({ sourceId: srcMatch }))
    await repo.seedItem(makeInboxItem({ sourceId: srcOther }))
    const findCurrentReviewIdsByAttention = vi.fn(async () => [srcMatch])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const result = await filteredRepo.findFilteredPaginated(
      { propertyId: PROP_A, attention: ['urgent', 'high'] },
      ORG_A,
      undefined,
      50,
    )

    expect(findCurrentReviewIdsByAttention).toHaveBeenCalledWith({
      organizationId: ORG_A,
      propertyIds: [PROP_A],
      attention: ['urgent', 'high'],
    })
    expect(result.items.map((item) => item.sourceId)).toEqual([srcMatch])
  })

  it('the Priority filter matches a level a manager set on private feedback', async () => {
    const feedback = await repo.seedItem(
      makeInboxItem({
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
      }),
    )
    await repo.seedItem(
      makeInboxItem({
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
      }),
    )
    await setManagerPriority(feedback.id, 'urgent')

    const result = await repo.findFilteredPaginated(
      { attention: ['urgent'] },
      ORG_A,
      undefined,
      50,
    )

    expect(result.items.map((item) => item.id)).toEqual([feedback.id])
    expect(result.totalCount).toBe(1)
  })

  it('a feedback-only Priority filter asks the AI nothing: feedback is never analysed', async () => {
    const feedback = await repo.seedItem(
      makeInboxItem({
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
      }),
    )
    await setManagerPriority(feedback.id, 'high')
    const findCurrentReviewIdsByAttention = vi.fn(async () => [])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const result = await filteredRepo.findFilteredPaginated(
      { sourceType: 'feedback', attention: ['urgent', 'high'] },
      ORG_A,
    )

    expect(result.items.map((item) => item.id)).toEqual([feedback.id])
    expect(findCurrentReviewIdsByAttention).not.toHaveBeenCalled()
  })

  it('a manager downgrade takes an AI Urgent review out of Urgent and into Low', async () => {
    const downgraded = await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }),
    )
    await setManagerPriority(downgraded.id, 'low')
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      // The AI still calls it Urgent.
      findCurrentReviewIdsByAttention: vi.fn(async (input: AttentionLookup) =>
        input.attention.includes('urgent') ? [downgraded.sourceId as never] : [],
      ),
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const urgent = await filteredRepo.findFilteredPaginated(
      { attention: ['urgent'] },
      ORG_A,
    )
    const low = await filteredRepo.findFilteredPaginated({ attention: ['low'] }, ORG_A)

    expect(urgent.items).toEqual([])
    expect(low.items.map((item) => item.id)).toEqual([downgraded.id])
  })

  it('set levels match with no AI port at all', async () => {
    const set = await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }),
    )
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))
    await setManagerPriority(set.id, 'high')

    // `repo` has no `aiInsights`: AI off for this reader.
    const result = await repo.findFilteredPaginated(
      { attention: ['urgent', 'high'] },
      ORG_A,
    )

    expect(result.items.map((item) => item.id)).toEqual([set.id])
  })

  it('an issue and polarity intersect with attention through the AI projection', async () => {
    const srcBoth = reviewId(crypto.randomUUID())
    const srcAttentionOnly = reviewId(crypto.randomUUID())
    const srcIssueOnly = reviewId(crypto.randomUUID())
    for (const sourceId of [srcBoth, srcAttentionOnly, srcIssueOnly]) {
      await repo.seedItem(makeInboxItem({ sourceId }))
    }
    const findCurrentReviewIdsByIssue = vi.fn(async () => [srcBoth, srcIssueOnly])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => [srcBoth, srcAttentionOnly]),
      findCurrentReviewIdsByIssue,
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })
    const issueId = 'a0000000-0000-4000-8000-000000000001'

    const result = await filteredRepo.findFilteredPaginated(
      {
        propertyId: PROP_A,
        attention: ['urgent'],
        issueId,
        polarity: ['negative'],
      },
      ORG_A,
      undefined,
      50,
    )

    expect(findCurrentReviewIdsByIssue).toHaveBeenCalledWith({
      organizationId: ORG_A,
      propertyIds: [PROP_A],
      issueId,
      polarities: ['negative'],
    })
    // Intersection, not union: only the review in BOTH id sets survives.
    expect(result.items.map((item) => item.sourceId)).toEqual([srcBoth])
  })

  it('an issue narrows to the reviews whose current analysis names it, with the polarity of the same mention', async () => {
    const named = reviewId(crypto.randomUUID())
    const other = reviewId(crypto.randomUUID())
    for (const sourceId of [named, other]) {
      await repo.seedItem(makeInboxItem({ sourceId }))
    }
    const findCurrentReviewIdsByIssue = vi.fn(async () => [named])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => []),
      findCurrentReviewIdsByIssue,
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })
    const issueId = 'a0000000-0000-4000-8000-000000000001'

    const result = await filteredRepo.findFilteredPaginated(
      { propertyId: PROP_A, issueId, polarity: ['negative'] },
      ORG_A,
      undefined,
      50,
    )

    expect(findCurrentReviewIdsByIssue).toHaveBeenCalledWith({
      organizationId: ORG_A,
      propertyIds: [PROP_A],
      issueId,
      polarities: ['negative'],
    })
    // A v3 analysis has issues and no aspects: the polarity belongs to the issue's mention.
    expect(result.items.map((item) => item.sourceId)).toEqual([named])
  })

  it('an old aspect or polarity link without an issue matches nothing and asks the AI nothing', async () => {
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))
    const findCurrentReviewIdsByIssue = vi.fn(async () => [])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => []),
      findCurrentReviewIdsByIssue,
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    for (const filters of [
      { propertyId: PROP_A, aspect: ['service' as const] },
      { propertyId: PROP_A, polarity: ['negative' as const] },
    ]) {
      const result = await filteredRepo.findFilteredPaginated(
        filters,
        ORG_A,
        undefined,
        50,
      )
      expect(result.items).toHaveLength(0)
    }
    expect(findCurrentReviewIdsByIssue).not.toHaveBeenCalled()
  })

  it('an issue nobody names means no review matches, never no filter', async () => {
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => []),
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const result = await filteredRepo.findFilteredPaginated(
      { propertyId: PROP_A, issueId: 'a0000000-0000-4000-8000-000000000001' },
      ORG_A,
      undefined,
      50,
    )

    expect(result.items).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })

  it('an empty AI id set means no aspect matches, never no filter', async () => {
    // The dangerous failure mode: a tenant without the AI capability, or an
    // aspect/polarity pair nobody has mentioned, resolves to zero review ids.
    // Skipping the predicate then would show the ENTIRE inbox while the UI
    // claims a filter is applied -- the same class of defect as a search param
    // that gets stripped before it reaches the query. The Priority filter is
    // held to the same rule for the suggestion: with no AI answer, only a
    // level a person set can match, and here nobody set one.
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => []),
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    for (const filters of [
      {
        propertyId: PROP_A,
        issueId: 'a0000000-0000-4000-8000-000000000001',
        polarity: ['negative' as const],
      },
      { propertyId: PROP_A, attention: ['urgent' as const] },
    ]) {
      const result = await filteredRepo.findFilteredPaginated(
        filters,
        ORG_A,
        undefined,
        50,
      )
      expect(result.items).toHaveLength(0)
      expect(result.nextCursor).toBeNull()
    }
  })

  it('an issue still narrows to reviews: a set level on feedback does not satisfy it', async () => {
    const feedback = await repo.seedItem(
      makeInboxItem({
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
      }),
    )
    await setManagerPriority(feedback.id, 'urgent')
    const review = await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }),
    )
    await setManagerPriority(review.id, 'urgent')
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => []),
      findCurrentReviewIdsByIssue: vi.fn(async () => [review.sourceId as never]),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const result = await filteredRepo.findFilteredPaginated(
      { attention: ['urgent'], issueId: 'a0000000-0000-4000-8000-000000000001' },
      ORG_A,
    )

    expect(result.items.map((item) => item.id)).toEqual([review.id])
  })

  it('counts equal the page total and the four levels plus Not set partition the list', async () => {
    // A shared fixture: a review the AI calls Urgent, one it calls High with a
    // manager's Medium over it, one with no analysis, feedback set to Low,
    // feedback with nothing set, and a review the id gate lists as Urgent
    // while its delivery read says `none` (a notice-mismatch review, §8): the
    // row and the filter follow the id lookup.
    const create = (sourceType: 'review' | 'feedback') =>
      repo.seedItem(
        makeInboxItem(
          sourceType === 'review'
            ? { sourceId: reviewId(crypto.randomUUID()) }
            : { sourceType, sourceId: feedbackId(crypto.randomUUID()) },
        ),
      )
    const aiUrgent = await create('review')
    const aiHighSetMedium = await create('review')
    const unanalysed = await create('review')
    const feedbackLow = await create('feedback')
    const feedbackNone = await create('feedback')
    const noticeMismatch = await create('review')
    await setManagerPriority(aiHighSetMedium.id, 'medium')
    await setManagerPriority(feedbackLow.id, 'low')
    const suggestions: Readonly<Record<string, readonly string[]>> = {
      urgent: [aiUrgent.sourceId, noticeMismatch.sourceId],
      high: [aiHighSetMedium.sourceId],
      medium: [],
      low: [],
    }
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'none' as const })),
      findCurrentReviewIdsByAttention: vi.fn(
        async (input: AttentionLookup) =>
          input.attention.flatMap((level) => suggestions[level] ?? []) as never,
      ),
      findCurrentReviewIdsByIssue: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...emptyLookupPorts, aiInsights })

    const ids = async (attention: readonly ('urgent' | 'high' | 'medium' | 'low')[]) => {
      const page = await filteredRepo.findFilteredPaginated({ attention }, ORG_A)
      const count = await filteredRepo.countFiltered({ attention }, ORG_A)
      expect(count).toBe(page.totalCount)
      expect(page.items).toHaveLength(count)
      return page.items.map((item) => item.id).sort()
    }
    const urgent = await ids(['urgent'])
    const high = await ids(['high'])
    const medium = await ids(['medium'])
    const low = await ids(['low'])
    const total = await filteredRepo.countFiltered({}, ORG_A)

    expect(urgent).toEqual([aiUrgent.id, noticeMismatch.id].sort())
    expect(high).toEqual([])
    expect(medium).toEqual([aiHighSetMedium.id])
    expect(low).toEqual([feedbackLow.id])
    expect(await ids(['urgent', 'high'])).toEqual(urgent)
    const notSet = [unanalysed.id, feedbackNone.id]
    expect(urgent.length + high.length + medium.length + low.length + notSet.length).toBe(
      total,
    )
    // The row's suggestion follows the same id lookup as the filter.
    const all = await filteredRepo.findFilteredPaginated({}, ORG_A)
    expect(all.items.find((item) => item.id === noticeMismatch.id)?.attention).toBe(
      'urgent',
    )
  })
})
