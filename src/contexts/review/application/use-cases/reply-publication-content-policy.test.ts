import { describe, expect, it, vi } from 'vitest'
import type { Reply, Review } from '../../domain/types'
import type { ReplyLibrarySnapshot } from '../ports/reply-library.repository'
import {
  approveReply,
  editPublishedReply,
  retryPublish,
  submitReply,
  type ReplyDeps,
} from './reply-operations'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-11-08T10:00:00Z')
const ORGANIZATION = organizationId('reply-content-policy')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('10000000-0000-4000-8000-000000000002')
const REPLY = replyId('10000000-0000-4000-8000-000000000003')
const ACTOR = userId('reply-content-manager')
const CTX = {
  organizationId: ORGANIZATION,
  userId: ACTOR,
  role: 'PropertyManager' as const,
}

type Command = 'submit' | 'approve' | 'edit' | 'retry'

function storedReply(command: Command, text: string): Reply {
  return {
    id: REPLY,
    organizationId: ORGANIZATION,
    reviewId: REVIEW,
    text,
    templateId: null,
    templateVersion: null,
    status:
      command === 'submit'
        ? 'draft'
        : command === 'approve'
          ? 'pending_approval'
          : command === 'edit'
            ? 'published'
            : 'publish_failed',
    source: 'internal',
    createdBy: ACTOR,
    approvedBy: command === 'retry' || command === 'edit' ? ACTOR : null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 4,
    submittedAt: null,
    approvedAt: null,
    publishedAt: command === 'edit' ? NOW : null,
    publicationState:
      command === 'edit' ? 'published' : command === 'retry' ? 'terminal' : null,
    publicationCycle: command === 'edit' || command === 'retry' ? 1 : 0,
    publicationAttempts: command === 'retry' ? 1 : 0,
    publicationLastErrorClass: command === 'retry' ? 'retryable' : null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function snapshot(
  accountPrivacy: boolean,
  propertyPrivacy?: boolean,
): ReplyLibrarySnapshot {
  const voice = (privacyMode: boolean, property: typeof PROPERTY | null) => ({
    organizationId: ORGANIZATION,
    propertyId: property,
    version: 2,
    overriddenFields: ['privacyMode'] as const,
    privacyMode,
  })
  return {
    propertyName: 'Harbor House',
    defaultReplyLanguage: 'en-Latn-US',
    accountVoice: voice(accountPrivacy, null),
    propertyVoice:
      propertyPrivacy === undefined ? null : voice(propertyPrivacy, PROPERTY),
    accountTemplates: [],
    propertyTemplates: [],
    visibility: [],
  }
}

function fixture(
  command: Command,
  text: string,
  voice: ReplyLibrarySnapshot | null = null,
  replyOverrides: Partial<Reply> = {},
) {
  const reply = { ...storedReply(command, text), ...replyOverrides }
  const review = {
    id: REVIEW,
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    rating: 2,
    text: 'The visit was disappointing.',
    languageCode: 'en',
    sourceEpoch: 0,
    sourceRevision: 1,
  } as Review
  // These stubs observe command admission only; persistence and its policy are
  // exercised by the PostgreSQL suites, not reproduced in this unit fixture.
  const commandStore = {
    submitReply: vi.fn(async () => ({ ...reply, status: 'pending_approval' as const })),
    markPublicationAuthorized: vi.fn(async () => ({
      ...reply,
      status: 'approved' as const,
    })),
    editPublishedReply: vi.fn(async () => ({ ...reply, status: 'approved' as const })),
    settleNeverDispatchedAttempt: vi.fn(),
  }
  const addPublishJob = vi.fn(async () => undefined)
  const loadSnapshot = vi.fn(async () => voice)
  const findCurrentHead = vi.fn(async () => null)
  const deps = {
    replyRepo: {
      findInternalByReviewId: vi.fn(async () => reply),
      findById: vi.fn(async () => reply),
      findCurrentPublicationAttemptStartedAt: vi.fn(
        async () => new Date(NOW.getTime() - 60 * 60 * 1000),
      ),
    },
    reviewRepo: { findById: vi.fn(async () => review) },
    commandStore,
    queue: { addPublishJob },
    replyLibrary: { loadSnapshot },
    googleReplyObservationStore: { findCurrentHead },
    propertyPublicationScope: {
      getPublicationScope: vi.fn(async () => ({ lifecycle: 'active', sourceEpoch: 0 })),
    },
    dispatchEvidence: { findDispatchEvidence: vi.fn(async () => 'possibly_dispatched') },
    staffPublicApi: { getAccessiblePropertyIds: vi.fn(async () => null) },
    clock: () => NOW,
    idGen: () => REPLY,
  } as unknown as ReplyDeps
  return {
    deps,
    reply,
    commandStore,
    addPublishJob,
    loadSnapshot,
    findCurrentHead,
    run: (editedText = text) => {
      if (command === 'submit') return submitReply(deps)({ reviewId: REVIEW }, CTX)
      if (command === 'approve') return approveReply(deps)({ reviewId: REVIEW }, CTX)
      if (command === 'edit')
        return editPublishedReply(deps)({ reviewId: REVIEW, text: editedText }, CTX)
      return retryPublish(deps)({ reviewId: REVIEW }, CTX)
    },
  }
}

function expectNoPublication(input: ReturnType<typeof fixture>) {
  expect(input.commandStore.submitReply).not.toHaveBeenCalled()
  expect(input.commandStore.markPublicationAuthorized).not.toHaveBeenCalled()
  expect(input.commandStore.editPublishedReply).not.toHaveBeenCalled()
  expect(input.addPublishJob).not.toHaveBeenCalled()
  expect(input.findCurrentHead).not.toHaveBeenCalled()
}

describe.each<Command>(['submit', 'approve', 'edit', 'retry'])(
  '%s content admission',
  (command) => {
    it.each([
      ['Visit https://example.com.', 'url'],
      ['Book now for a free night.', 'offer_or_solicitation'],
      ['We will sue you.', 'threat'],
      ['This is a fake review.', 'accusation'],
    ])('refuses %s before any publication write', async (text, findingCode) => {
      const input = fixture(
        command,
        command === 'edit' ? 'The earlier reply is safe.' : text,
      )
      await expect(input.run(text)).rejects.toMatchObject({
        code: 'invalid_reply',
        context: { findingCodes: expect.arrayContaining([findingCode]) },
      })
      expectNoPublication(input)
    })

    it.each([
      [true, undefined],
      [false, true],
    ])('applies current privacy settings (%s, %s)', async (account, property) => {
      const text = 'Thank you for being our patient.'
      const input = fixture(
        command,
        command === 'edit' ? 'Thank you.' : text,
        snapshot(account, property),
      )
      await expect(input.run(text)).rejects.toMatchObject({
        code: 'invalid_reply',
        context: { findingCodes: expect.arrayContaining(['privacy_content']) },
      })
      expect(input.loadSnapshot).toHaveBeenCalledWith(ORGANIZATION, PROPERTY)
      expectNoPublication(input)
    })

    it('honors a property privacy override instead of the account default', async () => {
      const text = 'Thank you for being our patient.'
      const input = fixture(
        command,
        command === 'edit' ? 'Thank you.' : text,
        snapshot(true, false),
      )
      await expect(input.run(text)).resolves.toBeDefined()
      expect(input.loadSnapshot).toHaveBeenCalledWith(ORGANIZATION, PROPERTY)
      expect(input.addPublishJob).toHaveBeenCalledTimes(command === 'submit' ? 0 : 1)
    })

    it('retains warning-only wording as admissible', async () => {
      const text = 'Your feedback is important and we strive to listen.'
      const input = fixture(command, command === 'edit' ? 'Thank you.' : text)
      await expect(input.run(text)).resolves.toBeDefined()
      expect(input.addPublishJob).toHaveBeenCalledTimes(command === 'submit' ? 0 : 1)
    })
  },
)

it('checks the new published edit without rejecting the text it replaces', async () => {
  const input = fixture('edit', 'Visit https://example.com.')
  await expect(
    input.run('Thank you for telling us about your visit.'),
  ).resolves.toBeDefined()
  expect(input.commandStore.editPublishedReply).toHaveBeenCalledWith(
    input.reply,
    expect.objectContaining({ text: 'Thank you for telling us about your visit.' }),
  )
  expect(input.addPublishJob).toHaveBeenCalledTimes(1)
})

it('keeps a confirmed publication as an idempotent retry without a new policy decision', async () => {
  const input = fixture('retry', 'Visit https://example.com.', null, {
    status: 'published',
    publicationState: 'published',
  })
  await expect(input.run()).resolves.toBe(input.reply)
  expect(input.loadSnapshot).not.toHaveBeenCalled()
  expectNoPublication(input)
})

it('does not use a content check to authorize an uncertain attempt again', async () => {
  const input = fixture('retry', 'Thank you for telling us about your visit.', null, {
    publicationState: 'ambiguous',
    publicationLastErrorClass: 'ambiguous',
  })
  await expect(input.run()).rejects.toMatchObject({
    code: 'invalid_transition',
    message:
      "RepKey won't send this reply again because Google may already have it. Use Check Google again instead.",
  })
  expect(input.commandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
  expectNoPublication(input)
})
