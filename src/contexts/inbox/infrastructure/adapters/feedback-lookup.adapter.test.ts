import { describe, expect, it, vi } from 'vitest'
import { feedbackId, organizationId } from '#/shared/domain/ids'
import { createFeedbackLookupAdapter } from './feedback-lookup.adapter'

const ORG = organizationId('org-feedback-lookup-test')

describe('createFeedbackLookupAdapter', () => {
  it('batches current responses first and queries legacy only for unresolved ids', async () => {
    const currentId = feedbackId('00000000-0000-4000-8000-000000000001')
    const legacyId = feedbackId('00000000-0000-4000-8000-000000000002')
    const legacy = vi.fn(async () => [
      { id: legacyId, comment: 'Legacy stay', ratingValue: 3 },
    ])
    const adapter = createFeedbackLookupAdapter({
      findResponseSnippetsByIds: vi.fn(async () => [
        { id: currentId, comment: null, ratingValue: null },
      ]),
      findEligibleResponseIds: vi.fn(async () => []),
      findLegacyFeedbackSnippetsByIds: legacy,
      findEligibleLegacyFeedbackIds: vi.fn(async () => []),
    })

    const snippets = await adapter.getFeedbackSnippetsByIds([currentId, legacyId], ORG)

    expect(legacy).toHaveBeenCalledWith([legacyId], ORG)
    expect(snippets.get(currentId)).toEqual({ comment: null, ratingValue: null })
    expect(snippets.get(legacyId)).toEqual({
      comment: 'Legacy stay',
      ratingValue: 3,
    })
  })

  it('unions eligible ids from both storage generations', async () => {
    const shared = feedbackId('00000000-0000-4000-8000-000000000010')
    const legacyOnly = feedbackId('00000000-0000-4000-8000-000000000011')
    const adapter = createFeedbackLookupAdapter({
      findResponseSnippetsByIds: vi.fn(async () => []),
      findEligibleResponseIds: vi.fn(async () => [shared]),
      findLegacyFeedbackSnippetsByIds: vi.fn(async () => []),
      findEligibleLegacyFeedbackIds: vi.fn(async () => [shared, legacyOnly]),
    })

    await expect(
      adapter.findEligibleFeedbackIds(ORG, { ratingMin: 4, textQuery: 'spa' }),
    ).resolves.toEqual([shared, legacyOnly])
  })
})
