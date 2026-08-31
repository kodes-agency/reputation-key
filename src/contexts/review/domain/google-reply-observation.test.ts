import { describe, expect, it } from 'vitest'
import { replyId } from '#/shared/domain/ids'
import {
  GOOGLE_REPLY_NORMALIZATION_VERSION,
  compareObservedGoogleReply,
  decideGoogleReplyObservation,
  normalizeGoogleReplyText,
  type GoogleReplyPublicationCandidate,
} from './google-reply-observation'

describe('Google reply observation normalization', () => {
  it('pins the comparison contract to an explicit version', () => {
    expect(GOOGLE_REPLY_NORMALIZATION_VERSION).toBe('google-reply-v1')
  })

  it('normalizes Unicode composition, line endings, and only outer whitespace', () => {
    expect(normalizeGoogleReplyText('  Cafe\u0301\r\nThank  you!  ')).toBe(
      'Caf\u00e9\nThank  you!',
    )
  })

  it('requires exact equality after the versioned normalization', () => {
    expect(compareObservedGoogleReply('Thanks!\r\n', ' Thanks!\n ')).toMatchObject({
      matches: true,
      normalizationVersion: 'google-reply-v1',
    })
    expect(compareObservedGoogleReply('Thank you!', 'Thanks!')).toMatchObject({
      matches: false,
      normalizationVersion: 'google-reply-v1',
    })
  })
})

describe('Google reply observation decision', () => {
  const scope = { sourceEpoch: 2, materialReviewRevision: 4 }
  const candidate = {
    replyId: replyId('reply-1'),
    publicationCycle: 3,
    attemptNumber: 1,
    sourceEpoch: 2,
    materialReviewRevision: 4,
    expectedReplyDigest: '',
    outcome: 'provider_outcome_pending' as const,
  }

  it('confirms only the exact current attempted text with every scope fence current', () => {
    const expectedReplyDigest = compareObservedGoogleReply(
      'Thank you!',
      'Thank you!',
    ).desiredDigest
    const decision = decideGoogleReplyObservation({
      ...scope,
      observedText: ' Thank you!\r\n',
      previous: null,
      candidate: { ...candidate, expectedReplyDigest },
    })

    expect(decision).toMatchObject({
      state: 'live',
      change: 'added',
      resolution: 'confirmed_on_google',
      provenance: 'repkey_confirmed',
      matchedReplyId: 'reply-1',
      matchedPublicationCycle: 3,
      matchedAttemptNumber: 1,
    })
  })

  it('closes a different current live reply as external without confirming the attempt', () => {
    const expectedReplyDigest = compareObservedGoogleReply(
      'Thank you!',
      'Thank you!',
    ).desiredDigest
    expect(
      decideGoogleReplyObservation({
        ...scope,
        observedText: 'Different',
        previous: null,
        candidate: { ...candidate, expectedReplyDigest },
      }),
    ).toMatchObject({
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      matchedAttemptNumber: null,
    })
  })

  it('treats an unchanged live head as external to a newer mismatched attempt', () => {
    const externalDigest = compareObservedGoogleReply(
      'External reply',
      'External reply',
    ).observedDigest
    const expectedReplyDigest = compareObservedGoogleReply(
      'Manager reply',
      'Manager reply',
    ).desiredDigest

    expect(
      decideGoogleReplyObservation({
        ...scope,
        observedText: 'External reply',
        previous: {
          state: 'live',
          normalizedDigest: externalDigest,
          ...scope,
        },
        candidate: { ...candidate, expectedReplyDigest },
      }),
    ).toMatchObject({
      change: 'unchanged',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
      matchedReplyId: null,
    })
  })

  const staleCandidates: ReadonlyArray<
    readonly [string, GoogleReplyPublicationCandidate]
  > = [
    ['source epoch', { ...candidate, sourceEpoch: 1 }],
    ['material revision', { ...candidate, materialReviewRevision: 3 }],
    ['attempt outcome', { ...candidate, outcome: 'retryable_failure' }],
  ]

  it.each(staleCandidates)(
    'does not attribute a provider reply when the %s fence differs',
    (_name, staleCandidate) => {
      const expectedReplyDigest = compareObservedGoogleReply(
        'Thank you!',
        'Thank you!',
      ).desiredDigest
      const decision = decideGoogleReplyObservation({
        ...scope,
        observedText: 'Thank you!',
        previous: null,
        candidate: { ...staleCandidate, expectedReplyDigest },
      })

      expect(decision.resolution).toBe('external_current_live')
      expect(decision.provenance).toBe('external_or_unknown')
      expect(decision.matchedReplyId).toBeNull()
    },
  )

  it('classifies live edit and deletion against the current observation head', () => {
    const previous = {
      state: 'live' as const,
      normalizedDigest: compareObservedGoogleReply('Old reply', 'Old reply')
        .observedDigest,
      sourceEpoch: 2,
      materialReviewRevision: 4,
    }
    expect(
      decideGoogleReplyObservation({
        ...scope,
        observedText: 'Edited reply',
        previous,
        candidate: null,
      }),
    ).toMatchObject({
      change: 'edited',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    })
    expect(
      decideGoogleReplyObservation({
        ...scope,
        observedText: null,
        previous,
        candidate: null,
      }),
    ).toMatchObject({ change: 'deleted', resolution: 'absent', state: 'absent' })
  })
})
