import { describe, expect, it } from 'vitest'
import { isReplyDraftingV2Binding } from './domain/reply-drafting-v2'
import { replyDraftingV2BindingSchema } from './reply-drafting-v2-binding'
import { resolveReplyDraftingV2Options } from './reply-drafting-v2-request'

const ROOT = {
  options: resolveReplyDraftingV2Options({ languageCode: 'en-Latn', variation: 0 }),
  voiceDigest: 'a'.repeat(64),
  generationSeed: 'b'.repeat(64),
  parentOperationId: null,
  rewriteOrdinal: 0,
  rewriteIssues: [],
}
describe('domain and transport binding parity', () => {
  it.each([
    ROOT,
    { ...ROOT, avoidTerms: ['private'] },
    { ...ROOT, options: { ...ROOT.options, apologyStart: 'private' } },
    { ...ROOT, extra: true },
    { ...ROOT, rewriteOrdinal: 2 },
    { ...ROOT, rewriteOrdinal: 1 },
    { ...ROOT, rewriteIssues: ['invitation'] },
    {
      ...ROOT,
      parentOperationId: '10000000-0000-4000-8000-000000000001',
      rewriteOrdinal: 1,
      rewriteIssues: ['invitation'],
    },
    {
      ...ROOT,
      parentOperationId: '10000000-0000-4000-8000-000000000001',
      rewriteOrdinal: 1,
      rewriteIssues: ['stock_phrase'],
    },
    { ...ROOT, options: { ...ROOT.options, maxWords: 8 } },
    { ...ROOT, options: { ...ROOT.options, length: 'short', maxWords: 8 } },
    { ...ROOT, options: { ...ROOT.options, length: 'short', maxWords: 81 } },
    { ...ROOT, options: { ...ROOT.options, variation: -1 } },
    { ...ROOT, options: { ...ROOT.options, opening: 4 } },
    { ...ROOT, rewriteIssues: ['arbitrary text'] },
  ])('keeps domain authority and closed transport in agreement: %#', (value) => {
    expect(replyDraftingV2BindingSchema.safeParse(value).success).toBe(
      isReplyDraftingV2Binding(value),
    )
  })
})
