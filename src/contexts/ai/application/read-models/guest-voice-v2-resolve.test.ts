import { describe, expect, it, vi } from 'vitest'
import type { GuestVoiceV2Draft, EvidenceCandidate } from './guest-voice-v2-evidence'
import { resolveDraftReviews, type DraftReviewReaders } from './guest-voice-v2-resolve'

function candidate(reviewId: string): EvidenceCandidate {
  return {
    reviewId,
    mentionOrdinal: 0,
    reviewedAt: '2026-10-18',
    rating: 2,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
    sentenceNumbers: [1],
  }
}

function draftOf(
  parts: Pick<GuestVoiceV2Draft, 'evidence' | 'latest'>,
): GuestVoiceV2Draft {
  return {
    read: {
      status: 'not_enough_reviews',
      readModelVersion: 'guest-voice-read-v2',
      textReviewCount: 0,
      latestReviews: [],
    },
    ...parts,
  }
}

function readers(
  items: Record<string, string>,
  texts: Record<string, string | null>,
  revisions: Record<string, number> = {},
): DraftReviewReaders & {
  inboxItemIds: ReturnType<typeof vi.fn>
  reviewTexts: ReturnType<typeof vi.fn>
} {
  return {
    inboxItemIds: vi.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids.flatMap((id) => (id in items ? [[id, items[id] as string] as const] : [])),
        ),
    ),
    reviewTexts: vi.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids.map(
            (id) =>
              [
                id,
                { text: texts[id] ?? null, sourceRevision: revisions[id] ?? 1 },
              ] as const,
          ),
        ),
    ),
  }
}

describe('resolveDraftReviews', () => {
  it('asks nothing when the draft has nothing to quote or list', async () => {
    const reader = readers({}, {})

    const resolved = await resolveDraftReviews(
      draftOf({ evidence: [], latest: [] }),
      reader,
    )

    expect(resolved.size).toBe(0)
    expect(reader.inboxItemIds).not.toHaveBeenCalled()
    expect(reader.reviewTexts).not.toHaveBeenCalled()
  })

  it('reads the words only of reviews the reader can open', async () => {
    const reader = readers({ a: 'item-a' }, { a: 'Words of a.', b: 'Words of b.' })
    const draft = draftOf({
      evidence: [
        {
          section: 'fixFirst',
          issueId: 'i',
          candidates: [candidate('a'), candidate('b')],
        },
      ],
      latest: [],
    })

    const resolved = await resolveDraftReviews(draft, reader)

    expect(reader.reviewTexts).toHaveBeenCalledWith(['a'])
    expect([...resolved]).toEqual([
      ['a', { inboxItemId: 'item-a', text: 'Words of a.', sourceRevision: 1 }],
    ])
  })

  it('asks once for a review that more than one card could quote', async () => {
    const reader = readers({ a: 'item-a' }, { a: 'Words.' })
    const draft = draftOf({
      evidence: [
        { section: 'urgent', issueId: 'i', candidates: [candidate('a')] },
        { section: 'fixFirst', issueId: 'i', candidates: [candidate('a')] },
      ],
      latest: [],
    })

    await resolveDraftReviews(draft, reader)

    expect(reader.inboxItemIds).toHaveBeenCalledWith(['a'])
    expect(reader.reviewTexts).toHaveBeenCalledWith(['a'])
  })

  it('opens a latest review without reading its words unless the page may show them', async () => {
    const reader = readers({ x: 'item-x', y: 'item-y' }, { x: 'Hello.', y: 'Hidden.' })
    const draft = draftOf({
      evidence: [],
      latest: [
        {
          reviewId: 'x',
          reviewedAt: '2026-10-18',
          rating: 5,
          mayShowText: true,
          sourceRevision: 1,
        },
        {
          reviewId: 'y',
          reviewedAt: '2026-10-17',
          rating: 4,
          mayShowText: false,
          sourceRevision: 1,
        },
      ],
    })

    const resolved = await resolveDraftReviews(draft, reader)

    expect(reader.reviewTexts).toHaveBeenCalledWith(['x'])
    expect(resolved.get('y')).toEqual({
      inboxItemId: 'item-y',
      text: null,
      sourceRevision: null,
    })
    expect(resolved.get('x')).toEqual({
      inboxItemId: 'item-x',
      text: 'Hello.',
      sourceRevision: 1,
    })
  })

  it('keeps a review that opens but whose words are gone, so its row still links', async () => {
    const reader = readers({ a: 'item-a' }, { a: null })
    const draft = draftOf({
      evidence: [],
      latest: [
        {
          reviewId: 'a',
          reviewedAt: '2026-10-18',
          rating: 3,
          mayShowText: true,
          sourceRevision: 1,
        },
      ],
    })

    const resolved = await resolveDraftReviews(draft, reader)

    expect(resolved.get('a')).toEqual({
      inboxItemId: 'item-a',
      text: null,
      sourceRevision: 1,
    })
  })

  // S2: the revision Review serves the words at travels with them, so the quote can
  // be refused where it is not the revision the analysis was made on.
  it('carries the revision the words were read at', async () => {
    const reader = readers({ a: 'item-a' }, { a: 'Edited words.' }, { a: 5 })
    const draft = draftOf({
      evidence: [{ section: 'fixFirst', issueId: 'i', candidates: [candidate('a')] }],
      latest: [],
    })

    const resolved = await resolveDraftReviews(draft, reader)

    expect(resolved.get('a')).toEqual({
      inboxItemId: 'item-a',
      text: 'Edited words.',
      sourceRevision: 5,
    })
  })
})
