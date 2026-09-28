import { describe, expect, it } from 'vitest'
import { replyId } from '#/shared/domain/ids'
import {
  compareObservedGoogleReply,
  decideGoogleReplyObservation,
  type PreviousGoogleReplyObservation,
} from './google-reply-observation'

// A reply written for Material Review Revision N does not answer revision
// N+1. When the guest edits an answered review and the owner reply is still
// live on Google, the first read at N+1 shows the SAME reply: it was carried
// over from N, not written for the edit, so it must not resolve as a live
// reply (which would close the Inbox cycle the edit just reopened). A reply
// that changed, or one RepKey published for N+1, still answers the edit.

const OLD_REPLY = 'Thank you for the five stars!'
const digest = (text: string) => compareObservedGoogleReply(text, text).observedDigest

const answeredAtRevisionOne: PreviousGoogleReplyObservation = {
  state: 'live',
  normalizedDigest: digest(OLD_REPLY),
  sourceEpoch: 0,
  materialReviewRevision: 1,
}

const afterEdit = { sourceEpoch: 0, materialReviewRevision: 2 }

describe('a reply observed after the guest edits an answered review', () => {
  it('does not treat the carried-over reply as answering the new revision', () => {
    expect(
      decideGoogleReplyObservation({
        ...afterEdit,
        observedText: `  ${OLD_REPLY}\r\n`,
        previous: answeredAtRevisionOne,
        candidate: null,
      }),
    ).toMatchObject({
      state: 'live',
      change: 'unchanged',
      resolution: 'unchanged',
      provenance: 'external_or_unknown',
      matchedReplyId: null,
    })
  })

  it('treats a reply the owner changed after the edit as answering it', () => {
    expect(
      decideGoogleReplyObservation({
        ...afterEdit,
        observedText: 'We are sorry the second visit let you down.',
        previous: answeredAtRevisionOne,
        candidate: null,
      }),
    ).toMatchObject({
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    })
  })

  it('confirms a RepKey reply published for the new revision, even with the old words', () => {
    const decision = decideGoogleReplyObservation({
      ...afterEdit,
      observedText: OLD_REPLY,
      previous: answeredAtRevisionOne,
      candidate: {
        replyId: replyId('reply-for-revision-two'),
        publicationCycle: 2,
        attemptNumber: 1,
        ...afterEdit,
        expectedReplyDigest: digest(OLD_REPLY),
        expectedReplyText: OLD_REPLY,
        outcome: 'provider_outcome_pending',
      },
    })

    expect(decision).toMatchObject({
      resolution: 'confirmed_on_google',
      provenance: 'repkey_confirmed',
      matchedReplyId: 'reply-for-revision-two',
    })
  })

  it('keeps a reply first seen at the new revision answering it', () => {
    expect(
      decideGoogleReplyObservation({
        ...afterEdit,
        observedText: OLD_REPLY,
        previous: { ...answeredAtRevisionOne, state: 'absent', normalizedDigest: null },
        candidate: null,
      }),
    ).toMatchObject({ change: 'added', resolution: 'external_current_live' })
  })

  // A source-epoch carry (Archive/Restore, relink) also advances the Material
  // Review Revision without any guest edit; Inbox relies on that observation
  // to carry its head, so a head from another epoch still cannot witness it.
  it('leaves a head from another source epoch unable to witness the reply', () => {
    expect(
      decideGoogleReplyObservation({
        sourceEpoch: 1,
        materialReviewRevision: 2,
        observedText: OLD_REPLY,
        previous: answeredAtRevisionOne,
        candidate: null,
      }),
    ).toMatchObject({ change: 'added', resolution: 'external_current_live' })
  })
})
