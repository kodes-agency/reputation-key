// Review context — reply command preconditions, by example.
//
// The exhaustive comparison with the hand-written workflow is
// reply-workflow.property.test.ts. These examples pin the refusal sentences a
// manager reads and the two rules that are not manager commands.

import { describe, expect, it } from 'vitest'
import {
  assertReplyCommandMayStart,
  hasPublicationRecord,
  replyCommandMayStart,
  type ReplyCommand,
  type ReplyCommandSubject,
} from './reply-command-preconditions'
import { isReviewError } from './errors'

const reply = (overrides: Partial<ReplyCommandSubject> = {}): ReplyCommandSubject => ({
  status: 'draft',
  publicationState: null,
  publicationCycle: 0,
  publicationLastErrorClass: null,
  ...overrides,
})

function refusal(command: ReplyCommand, subject: ReplyCommandSubject): unknown {
  try {
    assertReplyCommandMayStart(command, subject)
    return null
  } catch (error) {
    return error
  }
}

describe('assertReplyCommandMayStart', () => {
  it('returns for a reply the command may start from', () => {
    expect(refusal('save_draft', reply())).toBeNull()
    expect(refusal('approve', reply({ status: 'pending_approval' }))).toBeNull()
  })

  it.each([
    ['save_draft', 'Only a draft or a rejected reply can be edited'],
    ['submit', 'Only a draft can be submitted for approval'],
    [
      'approve',
      'Only a reply that is waiting for approval can be confirmed and published',
    ],
    ['reject', 'Only a reply that is waiting for approval can be rejected'],
    ['retry_publication', 'Only a reply that failed to publish can be sent again'],
    ['edit_published', 'Only a published reply can be edited and republished'],
    ['delete', 'Can only delete draft or rejected replies'],
  ] as const)(
    'refuses %s with a tagged invalid_transition and its own sentence',
    (command, message) => {
      const inFlight = reply({
        status: 'approved',
        publicationState: 'sending',
        publicationCycle: 1,
      })
      const error = refusal(command, inFlight)
      expect(isReviewError(error)).toBe(true)
      expect(error).toMatchObject({ code: 'invalid_transition', message })
    },
  )

  it('tells a manager why a draft with a publication record is kept', () => {
    const cancelled = reply({ publicationState: 'cancelled', publicationCycle: 1 })
    expect(refusal('delete', cancelled)).toMatchObject({
      code: 'invalid_transition',
      message:
        'This reply was confirmed for publishing before, so RepKey keeps it with its publication record. Edit it and submit it again, or leave it as a draft.',
    })
    // The same reply is still a draft a manager may rewrite and submit.
    expect(replyCommandMayStart('save_draft', cancelled)).toBe(true)
    expect(replyCommandMayStart('submit', cancelled)).toBe(true)
  })
})

describe('hasPublicationRecord', () => {
  it('is true once a cycle was authorized, whatever happened to it', () => {
    expect(hasPublicationRecord(reply())).toBe(false)
    expect(hasPublicationRecord(reply({ publicationCycle: 1 }))).toBe(true)
    expect(hasPublicationRecord(reply({ publicationState: 'cancelled' }))).toBe(true)
  })
})

describe('recording a reply as published', () => {
  it('starts only from a reply that was sent and not yet confirmed', () => {
    for (const status of ['approved', 'publish_failed'] as const) {
      for (const publicationState of [
        'sending',
        'pending_observation',
        'ambiguous',
        'terminal',
      ] as const) {
        expect(
          replyCommandMayStart('confirm_published', reply({ status, publicationState })),
        ).toBe(true)
      }
    }
  })

  it('never starts from a reply no manager confirmed, or one not yet claimed', () => {
    for (const subject of [
      reply(),
      reply({ status: 'pending_approval' }),
      reply({ status: 'rejected' }),
      reply({ status: 'approved', publicationState: 'authorized' }),
      reply({ status: 'published', publicationState: 'published' }),
    ]) {
      expect(replyCommandMayStart('confirm_published', subject)).toBe(false)
    }
  })
})

describe('Try publishing again', () => {
  it('starts from a settled failure and not from one whose outcome is unknown', () => {
    const failed = (overrides: Partial<ReplyCommandSubject>) =>
      reply({ status: 'publish_failed', publicationCycle: 1, ...overrides })

    expect(
      replyCommandMayStart(
        'retry_publication',
        failed({ publicationState: 'terminal', publicationLastErrorClass: 'retryable' }),
      ),
    ).toBe(true)
    expect(
      replyCommandMayStart(
        'retry_publication',
        failed({
          publicationState: 'terminal',
          publicationLastErrorClass: 'terminal_rejection',
        }),
      ),
    ).toBe(true)
    expect(
      replyCommandMayStart(
        'retry_publication',
        failed({ publicationState: 'terminal', publicationLastErrorClass: 'ambiguous' }),
      ),
    ).toBe(false)
    expect(
      replyCommandMayStart(
        'retry_publication',
        failed({ publicationState: 'ambiguous', publicationLastErrorClass: 'ambiguous' }),
      ),
    ).toBe(false)
    expect(
      replyCommandMayStart('retry_publication', failed({ publicationState: null })),
    ).toBe(false)
  })
})
