// Reply lifecycle use case tests

import { describe, it, expect, vi } from 'vitest'
import { draftReply, submitReply } from './reply-operations.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { Reply } from '../domain/review-types'
import { replyId } from '#/shared/domain/ids'
import {
  ORG_ID,
  OTHER_ORG_ID,
  REVIEW_ID,
  REPLY_ID,
  USER_ID,
  ADMIN_ID,
  PROP_ID,
  NOW,
  makeReview,
  makeReply,
  replyRepoWith,
  makeDeps,
  depsWith,
  MANAGER_CTX,
  ADMIN_CTX,
  MEMBER_CTX,
} from './reply-operations.test-fixtures'
import type { FakeGuardedWrite } from './reply-operations.test-fixtures'

// ── draftReply ──────────────────────────────────────────────────────────

describe('draftReply', () => {
  it.each([
    null,
    { id: REPLY_ID, stateRevision: 1 },
    { id: replyId('51000000-0000-4000-8000-000000000021'), stateRevision: 2 },
  ])('refuses a save from a stale browser snapshot: %j', async (expectedReply) => {
    const existing = makeReply({ stateRevision: 2 })
    const deps = makeDeps({ replyRepo: replyRepoWith(existing) })

    await expect(
      draftReply(deps)(
        { reviewId: REVIEW_ID, text: 'Another tab typed this', expectedReply },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('does not recreate a reply deleted since the browser read it', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)(
        {
          reviewId: REVIEW_ID,
          text: 'An old browser draft',
          expectedReply: { id: REPLY_ID, stateRevision: 1 },
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('saves the revision the browser actually read', async () => {
    const existing = makeReply({ stateRevision: 2 })
    const deps = makeDeps({ replyRepo: replyRepoWith(existing) })
    const saved = await draftReply(deps)(
      {
        reviewId: REVIEW_ID,
        text: 'The current browser draft',
        expectedReply: { id: existing.id, stateRevision: 2 },
      },
      MANAGER_CTX,
    )
    expect(saved.text).toBe('The current browser draft')
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ text: 'The current browser draft' }),
      NOW,
    )
  })

  it.each(['Hello Alexandra,', 'Regards, The management'])(
    'clears persisted frame boundaries after a greeting or sign-off edit: %s',
    async (replacement) => {
      const prefix = 'Hello Anna,'
      const suffix = 'Regards, Our team'
      const text = `${prefix}\n\nThe reply body stays the same.\n\n${suffix}`
      const existing = makeReply({
        text,
        voiceChoices: {
          closing: 0,
          signOff: 0,
          contactSentence: 0,
          emoji: 0,
          includeContact: true,
          bodyPrefixLength: prefix.length,
          bodySuffixLength: suffix.length,
        },
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(existing) })
      const next = replacement.startsWith('Hello')
        ? text.replace(prefix, replacement)
        : text.replace(suffix, replacement)
      await draftReply(deps)({ reviewId: REVIEW_ID, text: next }, MANAGER_CTX)
      expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
        existing,
        expect.objectContaining({
          text: next,
          voiceChoices: {
            ...existing.voiceChoices,
            bodyPrefixLength: undefined,
            bodySuffixLength: undefined,
          },
        }),
        NOW,
      )
    },
  )
  it('creates a new draft reply', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Thank you!' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
    expect(result.text).toBe('Thank you!')
    expect(result.source).toBe('internal')
    expect(result.aiGenerated).toBe(false)
    expect(deps.replyRepo.createDraft).toHaveBeenCalledTimes(1)
  })

  it('updates existing draft', async () => {
    const existing = makeReply({ status: 'draft' })
    const deps = depsWith(existing)
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Updated reply' },
      MANAGER_CTX,
    )
    expect(result.text).toBe('Updated reply')
    expect(result.status).toBe('draft')
  })

  it('clears AI attribution when the manager edits without provenance', async () => {
    const existing = makeReply({ status: 'draft', aiGenerated: true })
    const deps = depsWith(existing)

    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Manager-edited reply' },
      MANAGER_CTX,
    )

    // The draft save is the repository's human-authored write: the use case
    // hands it the AI-assisted reply and the manager's text, nothing else.
    expect(result.aiGenerated).toBe(false)
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      existing,
      { text: 'Manager-edited reply' },
      NOW,
    )
  })

  it('accepts an AI suggestion only through the atomic provenance store', async () => {
    const acceptedReply = makeReply({
      text: 'Suggested reply',
      aiGenerated: true,
      stateRevision: 2,
    })
    const accept = vi.fn(async () => ({
      status: 'accepted' as const,
      reply: acceptedReply,
    }))
    const deps = makeDeps({
      aiSuggestedDraftStore: {
        accept,
        assertCurrentBinding: vi.fn(async () => 'current' as const),
      },
    })

    const result = await draftReply(deps)(
      {
        reviewId: REVIEW_ID,
        text: 'Suggested reply',
        provenanceToken: 'signed-token',
      },
      MANAGER_CTX,
    )

    expect(result).toBe(acceptedReply)
    expect(accept).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      reviewId: REVIEW_ID,
      actorUserId: USER_ID,
      text: 'Suggested reply',
      provenanceToken: 'signed-token',
      now: NOW,
    })
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  it('refuses accepting an AI draft over a draft newer than the one on screen', async () => {
    const existing = makeReply({ stateRevision: 3 })
    const accept = vi.fn()
    const deps = makeDeps({
      replyRepo: replyRepoWith(existing),
      aiSuggestedDraftStore: { accept, assertCurrentBinding: vi.fn() },
    })

    await expect(
      draftReply(deps)(
        {
          reviewId: REVIEW_ID,
          text: 'Suggested reply',
          provenanceToken: 'signed-token',
          expectedReply: { id: existing.id, stateRevision: 2 },
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      message: 'Reply status changed concurrently',
    })
    expect(accept).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid', 'ai_suggestion_invalid'],
    ['expired', 'ai_suggestion_expired'],
    ['stale', 'ai_suggestion_stale'],
  ] as const)('rejects %s AI provenance without persisting', async (reason, code) => {
    const deps = makeDeps({
      aiSuggestedDraftStore: {
        accept: vi.fn(async () => ({ status: 'rejected' as const, reason })),
        assertCurrentBinding: vi.fn(async () => 'current' as const),
      },
    })

    await expect(
      draftReply(deps)(
        {
          reviewId: REVIEW_ID,
          text: 'Suggested reply',
          provenanceToken: 'signed-token',
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ _tag: 'ReviewError', code })
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  it('saves over an AI-assisted draft without asking whether its binding is still current', async () => {
    // Typing over AI text makes it the manager's own, however old it is.
    const aiDraft = makeReply({ aiGenerated: true })
    const assertCurrentBinding = vi.fn(async () => 'stale' as const)
    const deps = makeDeps({
      replyRepo: replyRepoWith(aiDraft),
      aiSuggestedDraftStore: { accept: vi.fn(), assertCurrentBinding },
    })

    const saved = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Typed by a manager' },
      MANAGER_CTX,
    )

    expect(saved).toMatchObject({ text: 'Typed by a manager', aiGenerated: false })
    expect(assertCurrentBinding).not.toHaveBeenCalled()
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      aiDraft,
      { text: 'Typed by a manager' },
      NOW,
    )
  })

  it('allows re-drafting a rejected reply', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const deps = depsWith(rejected)
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Improved reply' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
    expect(result.rejectionReason).toBeNull()
    expect(result.rejectedBy).toBeNull()
  })

  it('rejects empty text', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: '' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', _tag: 'ReviewError' })
  })

  it('rejects text exceeding max length', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'x'.repeat(4097) }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', _tag: 'ReviewError' })
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Hi' }, MEMBER_CTX),
    ).rejects.toMatchObject({ code: 'unauthorized', _tag: 'ReviewError' })
  })

  it('allows AccountAdmin role', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Admin reply' },
      ADMIN_CTX,
    )
    expect(result.status).toBe('draft')
  })

  it('rejects edit on pending_approval reply', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending)
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('refuses to re-draft a published reply', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = makeDeps({ replyRepo: replyRepoWith(published) })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  // `approved → draft` is the cancellation's move. A draft save that took it
  // rewrote the text of a reply a manager had confirmed, while its publication
  // was authorized, on the wire, or accepted by Google and not yet confirmed.
  it.each(['authorized', 'sending', 'pending_observation'] as const)(
    'refuses to rewrite a confirmed reply whose publication is %s',
    async (publicationState) => {
      const confirmed = makeReply({
        status: 'approved',
        approvedBy: ADMIN_ID,
        approvedAt: NOW,
        publicationState,
        publicationCycle: 1,
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(confirmed) })

      await expect(
        draftReply(deps)({ reviewId: REVIEW_ID, text: 'Stale tab' }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
        message: 'Only a draft or a rejected reply can be edited',
      })
      expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
      expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    },
  )

  it('refuses to rewrite a failed reply and one whose draft still carries an open publication', async () => {
    for (const reply of [
      makeReply({ status: 'publish_failed', publicationState: 'ambiguous' }),
      makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
      makeReply({ status: 'draft', publicationState: 'authorized', publicationCycle: 1 }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
      expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
    }
  })

  it('rewrites a draft whose publication was cancelled', async () => {
    const cancelled = makeReply({
      status: 'draft',
      publicationState: 'cancelled',
      publicationCycle: 1,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(cancelled) })

    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Second thoughts' },
      MANAGER_CTX,
    )

    expect(result).toMatchObject({ status: 'draft', text: 'Second thoughts' })
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      cancelled,
      { text: 'Second thoughts' },
      NOW,
    )
  })

  it('saves an existing draft through the guarded draft write, never an insert', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({ replyRepo: replyRepoWith(draft) })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Edited text', replyLanguageTag: 'en-GB' },
      MANAGER_CTX,
    )
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      draft,
      { text: 'Edited text', replyLanguageTag: 'en-GB' },
      NOW,
    )
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    expect(result.status).toBe('draft')
  })

  it('re-drafts a rejected reply from the snapshot it read', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const deps = makeDeps({ replyRepo: replyRepoWith(rejected) })
    await draftReply(deps)({ reviewId: REVIEW_ID, text: 'Improved' }, MANAGER_CTX)
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      rejected,
      { text: 'Improved' },
      NOW,
    )
  })

  it('treats a lost race on re-draft (the draft write returns null) as invalid_transition', async () => {
    const rejected = makeReply({ status: 'rejected' })
    const deps = depsWith(rejected, { saveDraft: vi.fn(async () => null) })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Try again' }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Reply status changed concurrently',
    })
  })

  it('does not overwrite a reply that appeared between its read and its insert', async () => {
    const deps = depsWith(null, { createDraft: vi.fn(async () => null) })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'First draft' }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Reply status changed concurrently',
    })
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('tags new reply with the caller organizationId (never a leaked org)', async () => {
    const createDraft = vi.fn(async (r: Reply) => r)
    const deps = depsWith(null, { createDraft })

    await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Tenant-scoped reply' },
      { ...MANAGER_CTX, organizationId: OTHER_ORG_ID },
    )

    expect(createDraft).toHaveBeenCalledTimes(1)
    const createdReply = createDraft.mock.calls[0]![0] as Reply
    expect(createdReply.organizationId).toBe(OTHER_ORG_ID)
  })
})

// ── submitReply ─────────────────────────────────────────────────────────

describe('submitReply', () => {
  it('transitions draft → pending_approval', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = depsWith(draft)
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('pending_approval')
  })

  it('sets submittedAt when submitting', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = depsWith(draft)
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.submittedAt).toBe(NOW)
  })

  it('rejects if no reply exists', async () => {
    const deps = makeDeps()
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'reply_not_found', _tag: 'ReviewError' })
  })

  it('rejects submit from published status', async () => {
    const published = makeReply({ status: 'published' })
    const deps = depsWith(published)
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('refuses a reply that is not a draft, or whose draft still carries an open publication', async () => {
    for (const reply of [
      makeReply({ status: 'pending_approval' }),
      makeReply({ status: 'rejected' }),
      makeReply({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 1,
      }),
      makeReply({ status: 'draft', publicationState: 'sending', publicationCycle: 1 }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        code: 'invalid_transition',
        _tag: 'ReviewError',
        message: 'Only a draft can be submitted for approval',
      })
      expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  it('records the reviewReplySubmitted fact with correct data', async () => {
    const draft = makeReply({ status: 'draft' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: replyRepoWith(draft),
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.outbox.byTag('review.reply.submitted')).toHaveLength(1)
    const fact = deps.outbox.byTag('review.reply.submitted')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)
    expect(fact.occurredAt).toBe(NOW)
  })

  it('refuses a draft with an unfilled template slot before transition', async () => {
    const draft = makeReply({ status: 'draft', text: 'Thank you, {guest_name}.' })
    const deps = depsWith(draft)

    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {guest_name}.',
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('uses the effective privacy voice for the final block-level fence', async () => {
    const draft = makeReply({ text: 'Thank you for being our patient.' })
    const deps = makeDeps({
      replyRepo: replyRepoWith(draft),
      replyLibrary: {
        loadSnapshot: vi.fn(async () => ({
          propertyName: 'Harbor House',
          defaultReplyLanguage: 'en-Latn-US',
          accountVoice: {
            organizationId: ORG_ID,
            propertyId: null,
            overriddenFields: ['privacyMode'] as const,
            localized: {},
            version: 1,
            privacyMode: true,
          },
          propertyVoice: null,
          accountTemplates: [],
          propertyTemplates: [],
          visibility: [],
        })),
      },
    })

    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      context: { findingCodes: expect.arrayContaining(['privacy_content']) },
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
  })

  it('treats a lost race (conditionalUpdate returns null) as invalid_transition', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = depsWith(draft, {
      conditionalUpdate: vi.fn(async () => null) as unknown as FakeGuardedWrite,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.outbox.facts).toHaveLength(0)
  })
})
