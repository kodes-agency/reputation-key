// Durable inbox consumers for reply lifecycle events: the first-reply
// milestone and the provider-observation authority that closes and stamps Inbox items.

import { describe, it, expect, vi } from 'vitest'
import {
  handleInboxReplyObserved,
  handleInboxReplySubmitted,
} from './outbox-consumers.server'
import {
  NOW,
  makeDeps,
  makeItem,
  reviewEvent,
  useOutboxConsumersDatabase,
} from './outbox-consumers.test-fixtures'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

useOutboxConsumersDatabase()

const SUBMITTED_RECEIPT = 'inbox.on-reply-submitted'
const OBSERVED_RECEIPT = 'inbox.on-reply-observed'

describe('handleInboxReplySubmitted (first-reply milestone)', () => {
  const submitted = (occurredAt: string = '2026-06-15T13:00:00.000Z') => ({
    ...reviewEvent('review.reply.submitted'),
    occurredAt,
  })

  it('stamps firstReplySubmittedAt from the envelope time without touching status', async () => {
    const { deps, repo, events, expectReceipt } = await makeDeps({})

    const result = await handleInboxReplySubmitted(deps, submitted())

    expect(result).toEqual({ status: 'applied' })
    const stored = await repo.first()
    expect(stored.firstReplySubmittedAt).toEqual(new Date('2026-06-15T13:00:00.000Z'))
    expect(stored.status).toBe('open')
    expect(await events.facts()).toHaveLength(0)
    await expectReceipt(SUBMITTED_RECEIPT, 'applied')
  })

  it('never overwrites an existing milestone on redelivery or a later reply', async () => {
    const first = new Date('2026-06-15T13:00:00.000Z')
    const { deps, repo, expectReceipt } = await makeDeps({
      item: makeItem({ firstReplySubmittedAt: first }),
    })

    await handleInboxReplySubmitted(deps, submitted('2026-06-16T09:00:00.000Z'))

    expect((await repo.first()).firstReplySubmittedAt).toEqual(first)
    await expectReceipt(SUBMITTED_RECEIPT, 'applied')
  })

  it('keeps the earliest time when two submissions are consumed newest first', async () => {
    const { deps, repo } = await makeDeps({})

    await handleInboxReplySubmitted(deps, submitted('2026-06-16T09:00:00.000Z'))
    await handleInboxReplySubmitted(deps, submitted('2026-06-15T13:00:00.000Z'))

    expect((await repo.first()).firstReplySubmittedAt).toEqual(
      new Date('2026-06-15T13:00:00.000Z'),
    )
  })

  it('leaves the time and commandRevision alone for a duplicate or later event', async () => {
    const { deps, repo } = await makeDeps({})
    await handleInboxReplySubmitted(deps, submitted('2026-06-15T13:00:00.000Z'))
    const before = await repo.first()

    await handleInboxReplySubmitted(deps, submitted('2026-06-15T13:00:00.000Z'))
    await handleInboxReplySubmitted(deps, submitted('2026-06-16T09:00:00.000Z'))

    const after = await repo.first()
    expect(after.firstReplySubmittedAt).toEqual(before.firstReplySubmittedAt)
    expect(after.commandRevision).toBe(before.commandRevision)
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  it('does not move the time later when the repository is asked directly', async () => {
    const first = new Date('2026-06-15T13:00:00.000Z')
    const { deps, repo } = await makeDeps({
      item: makeItem({ firstReplySubmittedAt: first }),
    })
    const before = await repo.first()

    const result = await deps.inboxRepo.stampReplyMilestones(
      before.id,
      before.organizationId,
      { firstReplySubmittedAt: new Date('2026-06-17T00:00:00.000Z') },
    )

    expect(result).toBeNull()
    expect((await repo.first()).commandRevision).toBe(before.commandRevision)
  })

  it('records an applied receipt when no inbox item exists for the review', async () => {
    const { deps, expectReceipt } = await makeDeps({ item: null })

    await expect(handleInboxReplySubmitted(deps, submitted())).resolves.toEqual({
      status: 'applied',
    })
    await expectReceipt(SUBMITTED_RECEIPT, 'applied')
  })
})

describe('handleInboxReplyObserved (provider-observation authority)', () => {
  const observationEvent = (overrides: Record<string, unknown> = {}) =>
    reviewEvent('review.reply.observed', {
      observationRevision: 1,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      change: 'added',
      resolution: 'confirmed_on_google',
      provenance: 'repkey_confirmed',
      matchedReplyId: 'reply-1',
      matchedPublicationCycle: 1,
      occurredAt: NOW.toISOString(),
      ...overrides,
    })

  /** An observation of a reply RepKey did not publish. */
  const externalObservation = (overrides: Record<string, unknown> = {}) =>
    observationEvent({
      provenance: 'external_or_unknown',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      ...overrides,
    })

  it('closes and stamps once from an exact observed confirmation', async () => {
    const { deps, repo, events, expectReceipt } = await makeDeps({})

    const result = await handleInboxReplyObserved(deps, observationEvent())

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.first()).toMatchObject({
      status: 'closed',
      closedAt: NOW,
      firstReplyPublishedAt: NOW,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    await expectReceipt(OBSERVED_RECEIPT, 'applied')
  })

  it('stamps the first reply at the time Google gave, and closes at the time RepKey saw it', async () => {
    const repliedAt = new Date(NOW.getTime() - 3 * 60 * 60_000)
    const { deps, repo } = await makeDeps({ providerReplyUpdatedAt: repliedAt })

    await handleInboxReplyObserved(deps, observationEvent())

    expect(await repo.first()).toMatchObject({
      status: 'closed',
      closedAt: NOW,
      firstReplyPublishedAt: repliedAt,
    })
  })

  it('closes and receipts an unchanged external-live head for a newer attempt', async () => {
    const { deps, repo, expectReceipt } = await makeDeps({})

    await handleInboxReplyObserved(
      deps,
      externalObservation({ change: 'unchanged', resolution: 'external_current_live' }),
    )

    expect((await repo.first()).status).toBe('closed')
    await expectReceipt(OBSERVED_RECEIPT, 'applied')
  })

  it('records an obsolete observation even when no Inbox item exists', async () => {
    const { deps, repo, expectReceipt, replyObservationAuthority } = await makeDeps({
      item: null,
      observationCurrent: false,
    })

    const result = await handleInboxReplyObserved(deps, observationEvent())

    expect(result).toEqual({ status: 'obsolete' })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(await repo.items()).toEqual([])
    await expectReceipt(OBSERVED_RECEIPT, 'obsolete')
  })

  it('refuses a genuinely stale material projection without a receipt', async () => {
    const { deps, repo, expectNoReceipts } = await makeDeps({})

    await expect(
      handleInboxReplyObserved(deps, observationEvent({ materialReviewRevision: 2 })),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      message: 'Current reply observation is waiting for the Inbox material revision',
    })
    expect((await repo.first()).status).toBe('open')
    await expectNoReceipts()
  })

  it('applies an epoch carry without reopening a closed item', async () => {
    const closedAt = new Date('2026-06-12T12:00:00Z')
    const { deps, repo, events, expectReceipt } = await makeDeps({
      item: makeItem({ status: 'closed', closedAt }),
      sourceEpochCarryFromMaterialReviewRevision: 1,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        externalObservation({
          sourceEpoch: 1,
          materialReviewRevision: 2,
          resolution: 'external_current_live',
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(await repo.first()).toMatchObject({ status: 'closed', closedAt })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    await expectReceipt(OBSERVED_RECEIPT, 'applied')
  })

  it('receipts an observation as obsolete when the Inbox Handling Cycle is newer', async () => {
    const { deps, repo, expectReceipt } = await makeDeps({
      handlingCycleMaterialReviewRevision: 2,
    })

    await expect(handleInboxReplyObserved(deps, observationEvent())).resolves.toEqual({
      status: 'obsolete',
    })
    expect((await repo.first()).status).toBe('open')
    await expectReceipt(OBSERVED_RECEIPT, 'obsolete')
  })

  it('reopens a closed item after an observed provider deletion', async () => {
    const first = new Date('2026-06-12T12:00:00Z')
    const { deps, repo, events } = await makeDeps({
      item: makeItem({
        status: 'closed',
        closedAt: first,
        firstReplyPublishedAt: first,
      }),
    })

    await handleInboxReplyObserved(
      deps,
      observationEvent({
        observationRevision: 2,
        matchedReplyId: null,
        matchedPublicationCycle: null,
        change: 'deleted',
        resolution: 'absent',
        provenance: 'none',
      }),
    )

    expect(await repo.first()).toMatchObject({
      status: 'open',
      closedAt: null,
      firstReplyPublishedAt: first,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(1)
  })

  it.each([
    ['external edit', 'external_current_live'],
    ['legacy divergence', 'diverged'],
  ] as const)(
    'does not reopen closed work for a live %s observation',
    async (_name, resolution) => {
      const first = new Date('2026-06-12T12:00:00Z')
      const { deps, repo, events } = await makeDeps({
        item: makeItem({
          status: 'closed',
          closedAt: first,
          firstReplyPublishedAt: first,
        }),
      })

      await handleInboxReplyObserved(
        deps,
        externalObservation({ observationRevision: 2, change: 'edited', resolution }),
      )

      expect(await repo.first()).toMatchObject({
        status: 'closed',
        closedAt: first,
        firstReplyPublishedAt: first,
      })
      expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    },
  )

  it('retries a current observation that arrives before its Inbox item', async () => {
    const {
      deps,
      repo,
      expectReceipt,
      expectNoReceipts,
      replyObservationAuthority,
      seedItem,
    } = await makeDeps({ item: null })
    const event = observationEvent()

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    await expectNoReceipts()

    await seedItem(makeItem())
    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    expect(await repo.first()).toMatchObject({
      status: 'closed',
      firstReplyPublishedAt: NOW,
    })
    await expectReceipt(OBSERVED_RECEIPT, 'applied')
  })

  it('retries without a receipt while the Inbox Handling Cycle is missing', async () => {
    const { deps, expectNoReceipts, replyObservationAuthority } = await makeDeps({
      handlingCycleMissing: true,
    })

    await expect(
      handleInboxReplyObserved(deps, observationEvent()),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    await expectNoReceipts()
  })
})
