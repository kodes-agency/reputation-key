// The reply command server functions the Inbox sends (draft, submit, approve,
// edit a published reply, reject, delete, try again, check Google), called as
// signed-in members over PostgreSQL with the real tenant resolution, execution
// policy and Review API. The reply state machine sits in the use-case suites;
// this file holds the boundary: who may call, what each command does to the
// stored reply and the facts it leaves, and what reaches the manager.
// reply-publication-functions.integration.test.ts covers the retry and check
// commands in depth.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import type {
  SeedReplyOptions,
  TestReview,
} from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  approveReplyFn,
  checkReplyPublicationFn,
  deleteReplyFn,
  draftReplyFn,
  editPublishedReplyFn,
  rejectReplyFn,
  retryPublishFn,
  submitReplyFn,
} from './reply'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'reply_publication_attempts',
    'reply_publication_authorizations',
    ...REVIEW_SEED_TABLES,
  ],
})

const TEXT = 'Thank you for staying with us.'
const NO_STORE = 'private, no-store, max-age=0'

type Command = Readonly<{
  name: string
  fn: (input: { data: never }) => Promise<unknown>
  data: (review: TestReview) => Record<string, unknown>
}>

const COMMANDS: readonly Command[] = [
  {
    name: 'draftReplyFn',
    fn: draftReplyFn,
    data: (review) => ({ reviewId: review.id, text: TEXT }),
  },
  {
    name: 'submitReplyFn',
    fn: submitReplyFn,
    data: (review) => ({ reviewId: review.id }),
  },
  {
    name: 'approveReplyFn',
    fn: approveReplyFn,
    data: (review) => ({ reviewId: review.id }),
  },
  {
    name: 'editPublishedReplyFn',
    fn: editPublishedReplyFn,
    data: (review) => ({ reviewId: review.id, text: 'Updated thanks.' }),
  },
  {
    name: 'rejectReplyFn',
    fn: rejectReplyFn,
    data: (review) => ({ reviewId: review.id, reason: 'Wrong guest name' }),
  },
  {
    name: 'deleteReplyFn',
    fn: deleteReplyFn,
    data: (review) => ({ reviewId: review.id }),
  },
  {
    name: 'retryPublishFn',
    fn: retryPublishFn,
    data: (review) => ({ reviewId: review.id }),
  },
  {
    name: 'checkReplyPublicationFn',
    fn: checkReplyPublicationFn,
    data: (review) => ({ reviewId: review.id }),
  },
]

const PUBLISHED: SeedReplyOptions = { status: 'published', publicationState: 'published' }

async function hotel(reply: SeedReplyOptions | null = PUBLISHED) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, { google: true })
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property)
  await harness.seedInboxItem({ review })
  const seeded = reply
    ? await harness.seedReply(review, { authorUserId: admin.userId, ...reply })
    : null
  return { organization, admin, manager, property, review, reply: seeded }
}

async function storedReply(review: TestReview) {
  const { rows } = await harness.pool().query<{
    id: string
    text: string
    status: string
    state_revision: string
    created_by: string | null
    approved_by: string | null
    rejection_reason: string | null
    publication_state: string | null
    publication_cycle: string
    authorship: string | null
  }>(
    `SELECT id, text, status, state_revision, created_by, approved_by,
            rejection_reason, publication_state, publication_cycle, authorship
       FROM replies WHERE review_id = $1`,
    [review.id],
  )
  return rows[0]
}

async function factTypes(organizationId: string) {
  const { rows } = await harness.pool().query<{ event_type: string }>(
    `SELECT event_type FROM outbox_events
      WHERE organization_id = $1 AND event_type LIKE 'review.reply.%'
      ORDER BY created_at, id`,
    [organizationId],
  )
  return rows.map((row) => row.event_type)
}

describe('reply command server functions', () => {
  it.each(COMMANDS)('$name is a POST', ({ fn }) => {
    expect(fn).toHaveProperty('method', 'POST')
  })

  it.each(COMMANDS)(
    '$name refuses a review id that is not a UUID before resolving the caller',
    async ({ fn, data }) => {
      const { review } = await hotel()

      await expect(
        harness.callAs(null, () =>
          fn({ data: { ...data(review), reviewId: 'x' } as never }),
        ),
      ).rejects.toThrow(/reviewId/)
    },
  )

  it.each(COMMANDS)(
    '$name refuses a caller with no session and a member without beta manager access',
    async ({ fn, data }) => {
      const { organization, review } = await hotel()
      const member = await harness.seedMember(organization, 'Member')
      const before = await storedReply(review)

      await expect(
        harness.callAs(null, () => fn({ data: data(review) as never })),
      ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
      await expect(
        harness.callAs(member, () => fn({ data: data(review) as never })),
      ).rejects.toMatchObject({ code: 'beta_role_inactive' })
      expect(await storedReply(review)).toEqual(before)
    },
  )

  it.each(COMMANDS)(
    '$name refuses a PropertyManager without a grant on the Property and changes nothing',
    async ({ fn, data }) => {
      const { organization, review } = await hotel()
      const outsider = await harness.seedMember(organization, 'PropertyManager')
      const before = await storedReply(review)

      await expect(
        harness.callAs(outsider, () => fn({ data: data(review) as never })),
      ).rejects.toMatchObject({ name: 'ReviewError', status: 403 })
      expect(await storedReply(review)).toEqual(before)
    },
  )

  it.each(COMMANDS.filter(({ name }) => name !== 'draftReplyFn'))(
    '$name does not find the reply for an AccountAdmin of another Organization',
    async ({ fn, data }) => {
      const { review } = await hotel()
      const elsewhere = await harness.seedOrganization()
      const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
      const before = await storedReply(review)

      await expect(
        harness.callAs(otherAdmin, () => fn({ data: data(review) as never })),
      ).rejects.toMatchObject({ name: 'ReviewError', status: 404 })
      expect(await storedReply(review)).toEqual(before)
    },
  )

  it('draftReplyFn does not find the review for an AccountAdmin of another Organization', async () => {
    const { review } = await hotel(null)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        draftReplyFn({ data: { reviewId: review.id, text: TEXT } }),
      ),
    ).rejects.toMatchObject({ name: 'ReviewError', status: 404 })
    expect(await storedReply(review)).toBeUndefined()
  })
})

describe('draft, submit and approve', () => {
  it('takes a PropertyManager from a draft through submission to an approved reply and one publication request', async () => {
    const { organization, manager, review } = await hotel(null)

    const drafted = await harness.callAs(manager, () =>
      draftReplyFn({ data: { reviewId: review.id, text: TEXT } }),
    )
    expect(await storedReply(review)).toMatchObject({
      id: drafted.id,
      text: TEXT,
      status: 'draft',
      created_by: manager.userId,
    })

    const submitted = await harness.callAs(manager, () =>
      submitReplyFn({ data: { reviewId: review.id } }),
    )
    expect(submitted).toMatchObject({ id: drafted.id, status: 'pending_approval' })

    const approved = await harness.callAs(manager, () =>
      approveReplyFn({
        data: {
          reviewId: review.id,
          expectedReply: { id: submitted.id, stateRevision: submitted.stateRevision },
        },
      }),
    )

    expect(approved).toMatchObject({ id: drafted.id, status: 'approved' })
    expect(await storedReply(review)).toMatchObject({
      status: 'approved',
      approved_by: manager.userId,
      publication_state: 'authorized',
    })
    expect(await factTypes(organization.id)).toEqual([
      'review.reply.submitted',
      'review.reply.approved',
      'review.reply.publication_requested',
    ])
    expect(harness.fakes().queues.default.enqueuedJobs).toHaveLength(1)
  })

  it('refuses to approve a reply other than the one the screen showed', async () => {
    const { manager, review, reply } = await hotel({ status: 'pending_approval' })

    await expect(
      harness.callAs(manager, () =>
        approveReplyFn({
          data: {
            reviewId: review.id,
            expectedReply: { id: reply!.id, stateRevision: 99 },
          },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'ReviewError',
      code: 'invalid_transition',
      status: 400,
    })
    expect(await storedReply(review)).toMatchObject({ status: 'pending_approval' })
    expect(harness.fakes().queues.default.enqueuedJobs).toEqual([])
  })

  it('sets caching headers before it resolves the caller, so a refusal carries them too', async () => {
    const { manager, review } = await hotel(null)

    const answered = await harness.respondAs(manager, () =>
      draftReplyFn({ data: { reviewId: review.id, text: TEXT } }),
    )
    const refused = await harness.respondAs(null, () =>
      draftReplyFn({ data: { reviewId: review.id, text: TEXT } }),
    )

    for (const response of [answered, refused]) {
      expect(response.headers.get('cache-control')).toBe(NO_STORE)
      expect(response.headers.get('pragma')).toBe('no-cache')
      expect(response.headers.get('expires')).toBe('0')
    }
    expect(answered.ok).toBe(true)
    expect(refused.ok).toBe(false)
  })
})

describe('rejectReplyFn', () => {
  it('rejects a pending reply with the reason and leaves one fact', async () => {
    const { organization, manager, review } = await hotel({ status: 'pending_approval' })

    await harness.callAs(manager, () =>
      rejectReplyFn({ data: { reviewId: review.id, reason: 'Wrong guest name' } }),
    )

    expect(await storedReply(review)).toMatchObject({
      status: 'rejected',
      rejection_reason: 'Wrong guest name',
    })
    expect(await factTypes(organization.id)).toEqual(['review.reply.rejected'])
  })
})

describe('deleteReplyFn', () => {
  it('answers success with nothing restarted once a draft is deleted', async () => {
    const { manager, review } = await hotel({ status: 'draft' })

    const answered = await harness.callAs(manager, () =>
      deleteReplyFn({ data: { reviewId: review.id } }),
    )

    expect(answered).toEqual({ success: true, restarted: null })
    expect(await storedReply(review)).toBeUndefined()
  })

  it('names the reply a failed one was cleared into and keeps the row', async () => {
    const { manager, review, reply } = await hotel({
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationLastErrorClass: 'terminal_rejection',
      publicationAttempts: 1,
    })

    const answered = await harness.callAs(manager, () =>
      deleteReplyFn({ data: { reviewId: review.id } }),
    )

    expect(answered).toEqual({
      success: true,
      restarted: { id: reply!.id, stateRevision: expect.any(Number) },
    })
    expect(await storedReply(review)).toMatchObject({ id: reply!.id, status: 'draft' })
  })

  it('maps a missing reply to a 404 with the sentence the manager reads', async () => {
    const { admin, review } = await hotel(null)

    await expect(
      harness.callAs(admin, () => deleteReplyFn({ data: { reviewId: review.id } })),
    ).rejects.toMatchObject({ name: 'ReviewError', code: 'reply_not_found', status: 404 })
  })
})

describe('editPublishedReplyFn', () => {
  it('republishes the new text in a new cycle and ignores a provenance token', async () => {
    const { organization, admin, review } = await hotel()

    await harness.callAs(admin, () =>
      editPublishedReplyFn({
        data: {
          reviewId: review.id,
          text: 'Updated thanks.',
          provenanceToken: 'token-1',
        },
      }),
    )

    expect(await storedReply(review)).toMatchObject({
      text: 'Updated thanks.',
      status: 'approved',
      publication_cycle: '2',
      authorship: 'human',
    })
    expect(await factTypes(organization.id)).toContain('review.reply.updated')
    expect(harness.fakes().queues.default.enqueuedJobs).toHaveLength(1)
  })

  it('does nothing when the trimmed text is unchanged', async () => {
    const { organization, admin, review } = await hotel({ ...PUBLISHED, text: TEXT })
    const before = await storedReply(review)

    await harness.callAs(admin, () =>
      editPublishedReplyFn({ data: { reviewId: review.id, text: `  ${TEXT}  ` } }),
    )

    expect(await storedReply(review)).toEqual(before)
    expect(await factTypes(organization.id)).toEqual([])
    expect(harness.fakes().queues.default.enqueuedJobs).toEqual([])
  })
})
