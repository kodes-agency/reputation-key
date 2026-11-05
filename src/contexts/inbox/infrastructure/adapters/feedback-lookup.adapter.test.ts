import { describe, expect, it, vi } from 'vitest'
import { feedbackId, organizationId } from '#/shared/domain/ids'
import { createFeedbackLookupAdapter } from './feedback-lookup.adapter'

const ORG = organizationId('org-feedback-lookup-test')
const emptyLegacy = () => ({
  findLegacyFeedbackSnippetsByIds: vi.fn(async () => []),
  findEligibleLegacyFeedbackIds: vi.fn(async () => []),
})

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
    expect(snippets.get(currentId)).toEqual({
      comment: null,
      ratingValue: null,
      responseRevision: null,
    })
    expect(snippets.get(legacyId)).toEqual({
      comment: 'Legacy stay',
      ratingValue: 3,
      responseRevision: null,
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

  it('batches current response snippets and leaves unknown sources unresolved', async () => {
    const currentId = feedbackId('00000000-0000-4000-8000-000000000001')
    const missingId = feedbackId('00000000-0000-4000-8000-000000000002')
    const read = vi.fn(async () => [
      {
        id: currentId,
        comment: 'Quiet rooms',
        ratingValue: 3,
        feedbackSubmissionRevision: 2,
      },
    ])
    const adapter = createFeedbackLookupAdapter({
      ...emptyLegacy(),
      findResponseSnippetsByIds: read,
      findEligibleResponseIds: vi.fn(async () => []),
    })

    const snippets = await adapter.getFeedbackSnippetsByIds([currentId, missingId], ORG)

    expect(read).toHaveBeenCalledExactlyOnceWith([currentId, missingId], ORG)
    expect(snippets.get(currentId)).toEqual({
      comment: 'Quiet rooms',
      ratingValue: 3,
      responseRevision: 2,
    })
    expect(snippets.has(missingId)).toBe(false)
  })

  it('passes the Organization and content filter to the response lookup', async () => {
    const id = feedbackId('00000000-0000-4000-8000-000000000010')
    const findEligible = vi.fn(async () => [id])
    const adapter = createFeedbackLookupAdapter({
      ...emptyLegacy(),
      findResponseSnippetsByIds: vi.fn(async () => []),
      findEligibleResponseIds: findEligible,
    })
    const filter = { ratingMin: 2, ratingMax: 4, textQuery: 'spa' }

    await expect(adapter.findEligibleFeedbackIds(ORG, filter)).resolves.toEqual([id])
    expect(findEligible).toHaveBeenCalledExactlyOnceWith(ORG, filter)
  })

  it('keeps a redacted response snippet without inventing content or a revision', async () => {
    const id = feedbackId('00000000-0000-4000-8000-000000000020')
    const legacy = vi.fn(async () => [{ id, comment: 'Stale text', ratingValue: 5 }])
    const adapter = createFeedbackLookupAdapter({
      ...emptyLegacy(),
      findLegacyFeedbackSnippetsByIds: legacy,
      findResponseSnippetsByIds: vi.fn(async () => [
        { id, comment: null, ratingValue: null },
      ]),
      findEligibleResponseIds: vi.fn(async () => []),
    })

    await expect(adapter.getFeedbackSnippetById(id, ORG)).resolves.toEqual({
      comment: null,
      ratingValue: null,
      responseRevision: null,
    })
    expect(legacy).not.toHaveBeenCalled()
  })

  it('returns null for an unavailable response in the requested Organization', async () => {
    const id = feedbackId('00000000-0000-4000-8000-000000000030')
    const read = vi.fn(async () => [])
    const adapter = createFeedbackLookupAdapter({
      ...emptyLegacy(),
      findResponseSnippetsByIds: read,
      findEligibleResponseIds: vi.fn(async () => []),
    })
    const otherOrg = organizationId('org-other')

    await expect(adapter.getFeedbackSnippetById(id, otherOrg)).resolves.toBeNull()
    expect(read).toHaveBeenCalledExactlyOnceWith([id], otherOrg)
  })

  it('does not read storage for an empty batch', async () => {
    const read = vi.fn(async () => [])
    const adapter = createFeedbackLookupAdapter({
      ...emptyLegacy(),
      findResponseSnippetsByIds: read,
      findEligibleResponseIds: vi.fn(async () => []),
    })

    await expect(adapter.getFeedbackSnippetsByIds([], ORG)).resolves.toEqual(new Map())
    expect(read).not.toHaveBeenCalled()
  })
})
