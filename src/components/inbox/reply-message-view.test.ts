import { describe, expect, it } from 'vitest'
import { presentReplyMessage, type ResolvedReplyView } from './reply-message-view'

type Reply = Extract<ResolvedReplyView, { kind: 'pending' }>['reply']

const SUBMITTED_AT = new Date('2026-09-12T09:00:00.000Z')
const APPROVED_AT = new Date('2026-09-12T09:05:00.000Z')
const PUBLISHED_AT = new Date('2026-09-12T09:20:00.000Z')
const UPDATED_AT = new Date('2026-09-12T10:00:00.000Z')

const BASE: Reply = {
  id: 'reply-1' as Reply['id'],
  reviewId: 'review-1' as Reply['reviewId'],
  organizationId: 'org-1' as Reply['organizationId'],
  text: 'Thank you for staying with us.',
  replyLanguageTag: 'en',
  templateId: null,
  templateVersion: null,
  status: 'pending_approval',
  source: 'internal',
  createdBy: 'user-1' as Reply['createdBy'],
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 3,
  submittedAt: SUBMITTED_AT,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationCycle: 0,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: new Date('2026-09-12T08:00:00.000Z'),
  updatedAt: UPDATED_AT,
}

const reply = (overrides: Partial<Reply> = {}): Reply => ({ ...BASE, ...overrides })

describe('presentReplyMessage', () => {
  it('keeps a draft and a missing reply out of the thread entirely', () => {
    expect(presentReplyMessage({ kind: 'compose', reply: null })).toBeNull()
    expect(
      presentReplyMessage({ kind: 'compose', reply: reply({ status: 'draft' }) }),
    ).toBeNull()
    expect(presentReplyMessage({ kind: 'none' })).toBeNull()
  })

  it('offers approve and reject on a reply awaiting approval', () => {
    expect(presentReplyMessage({ kind: 'pending', reply: reply() })).toEqual({
      chip: 'Awaiting approval',
      tone: 'accent',
      meta: { label: 'Submitted', at: SUBMITTED_AT },
      detail: null,
      reason: null,
      actions: ['approve', 'reject'],
    })
  })

  it('drops the meta line rather than print a label with no time behind it', () => {
    const view = presentReplyMessage({
      kind: 'pending',
      reply: reply({ submittedAt: null }),
    })

    expect(view?.meta).toBeNull()
    expect(view?.chip).toBe('Awaiting approval')
  })

  it('gives a confirmed reply no actions while Google has it', () => {
    const view = presentReplyMessage({
      kind: 'approved',
      reply: reply({
        status: 'approved',
        approvedAt: APPROVED_AT,
        publicationState: 'sending',
      }),
    })

    expect(view).toEqual({
      chip: 'Waiting for Google',
      tone: 'neutral',
      meta: { label: 'Confirmed', at: APPROVED_AT },
      detail:
        'RepKey is sending this reply to Google. It will keep checking until the exact reply is confirmed live.',
      reason: null,
      actions: [],
    })
  })

  /**
   * One chip covers five publication states, so the description is the only
   * thing that separates them — and this presenter is now its only renderer.
   * Nothing else on the surface tells "not attempted yet" from "Google already
   * accepted it", which are the two ends of a support question.
   */
  it('says which stage the publication machine is in under the one chip', () => {
    const stage = (
      publicationState: Reply['publicationState'],
    ): string | null | undefined =>
      presentReplyMessage({
        kind: 'approved',
        reply: reply({ status: 'approved', approvedAt: APPROVED_AT, publicationState }),
      })?.detail

    expect(stage(null)).toContain('will start publishing this reply shortly')
    expect(stage('requested')).toContain('will start publishing this reply shortly')
    expect(stage('sending')).toContain('is sending this reply to Google')
    expect(stage('pending_observation')).toContain('Google accepted the update')
  })

  it('lets a live reply be edited', () => {
    expect(
      presentReplyMessage({
        kind: 'published',
        reply: reply({ status: 'published', publishedAt: PUBLISHED_AT }),
      }),
    ).toEqual({
      chip: 'Live on Google',
      tone: 'positive',
      meta: { label: 'Live on Google', at: PUBLISHED_AT },
      detail: null,
      reason: null,
      actions: ['editPublished'],
    })
  })

  it('says where a Google-authored mirror came from, and offers nothing to do', () => {
    expect(
      presentReplyMessage({
        kind: 'mirror',
        reply: reply({
          status: 'published',
          source: 'google_sync',
          publishedAt: PUBLISHED_AT,
        }),
      }),
    ).toEqual({
      chip: 'Live on Google',
      tone: 'positive',
      meta: { label: 'Observed via Google Business Profile', at: PUBLISHED_AT },
      detail: null,
      reason: null,
      actions: [],
    })
  })

  it('asks for a read, never a resend, when the publication outcome is unknown', () => {
    const view = presentReplyMessage({
      kind: 'failed-check',
      reply: reply({
        status: 'publish_failed',
        approvedAt: APPROVED_AT,
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
        publicationAttempts: 2,
      }),
    })

    expect(view?.chip).toBe('Needs a check')
    // Not `negative`: the reply may well be live, and red would assert an
    // outcome the domain says is unknown.
    expect(view?.tone).toBe('accent')
    expect(view?.actions).toEqual(['check'])
    expect(view?.detail).toContain('To avoid posting twice')
  })

  it('counts the attempts on a failure that is safe to send again', () => {
    const view = presentReplyMessage({
      kind: 'failed-retry',
      reply: reply({
        status: 'publish_failed',
        approvedAt: APPROVED_AT,
        publicationLastErrorClass: 'retryable',
        publicationAttempts: 3,
      }),
    })

    expect(view?.chip).toBe('Not published')
    expect(view?.detail).toContain('stopped after 3 attempts')
    // Retry is the ONLY action. `editPublishedReply` refuses anything but a
    // `published` reply and `REPLY_TRANSITIONS.publish_failed` has no `draft`,
    // so no server path changes the text of a publish-failed reply — an edit
    // offered here could only ever fail into a toast.
    expect(view?.actions).toEqual(['retry'])
  })

  it('explains a provider rejection under the same Not published chip', () => {
    const view = presentReplyMessage({
      kind: 'failed-retry',
      reply: reply({
        status: 'publish_failed',
        approvedAt: APPROVED_AT,
        publicationLastErrorClass: 'terminal_rejection',
        publicationAttempts: 1,
      }),
    })

    expect(view?.chip).toBe('Not published')
    expect(view?.detail).toContain('Google rejected this update')
    expect(view?.actions).toEqual(['retry'])
  })

  /**
   * A colleague's words travel in `reason`, never in `detail`: `detail` is
   * RepKey's own copy, and the render site labels the two differently. Sharing
   * one slot made a rejection note indistinguishable from a system sentence.
   */
  it('carries the reason a reply was rejected as authored copy, not system copy', () => {
    expect(
      presentReplyMessage({
        kind: 'rejected',
        reply: reply({
          status: 'rejected',
          rejectionReason: 'Too generic — name the housekeeping issue.',
        }),
      }),
    ).toEqual({
      chip: 'Rejected',
      tone: 'negative',
      meta: { label: 'Rejected', at: UPDATED_AT },
      detail: null,
      reason: 'Too generic — name the housekeeping issue.',
      actions: ['editRejected'],
    })
  })

  it('leaves no blank reason line when a rejection carried none', () => {
    expect(
      presentReplyMessage({
        kind: 'rejected',
        reply: reply({ status: 'rejected', rejectionReason: null }),
      })?.reason,
    ).toBeNull()

    expect(
      presentReplyMessage({
        kind: 'rejected',
        reply: reply({ status: 'rejected', rejectionReason: '' }),
      })?.reason,
    ).toBeNull()
  })
})
