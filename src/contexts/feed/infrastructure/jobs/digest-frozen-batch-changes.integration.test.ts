// A frozen digest whose content or membership changed before its retry, against
// real PostgreSQL. A batch the provider refused on every attempt never held
// the mail, so it is rebuilt under a new key; one the provider may have
// accepted keeps its key, and re-sending the rest under a new one could mail
// the digest twice.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationDigestBatches } from '#/shared/db/schema'
import { settleDigestBatch } from '../../email/notification-digest-batch.server'
import { createResendSenderAnswering } from './test-fixtures'
import { freezeBatchAtFirstSweep } from './digest-retry-seed'
import {
  HOUR,
  NOW,
  openDigestWorld,
  ORG,
  PROP_A,
  USER,
  type DigestWorld,
} from './digest-job-test-deps'

const NEW_BATCH = '86000000-0000-4000-8000-000000000100'

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld()
})

afterEach(async () => {
  await world.rollBack()
})

// The retry's id generator starts over, so a rebuilt batch needs its own id.
const retryDeps = (options: Parameters<DigestWorld['deps']>[0] = {}) => {
  const deps = world.deps({ now: new Date(NOW.getTime() + HOUR), ...options })
  deps.batchIdGen.mockReturnValue(NEW_BATCH)
  return deps
}

const forgetStoredRequest = (batchId: string) =>
  world.db
    .update(notificationDigestBatches)
    .set({ providerRequest: null })
    .where(eq(notificationDigestBatches.id, batchId))

const batchById = async (id: string) =>
  (await world.batches()).find((batch) => batch.id === id)

describe('digest retries after the content changed', () => {
  it('renders a retry with the day the batch was frozen for, even after midnight', async () => {
    const { batch, firstRequest } = await freezeBatchAtFirstSweep(world)
    await forgetStoredRequest(batch.id)
    const retry = world.deps({ now: new Date('2026-07-12T00:30:00.000Z') })

    await world.run(retry)

    expect(retry.emailSender.send).toHaveBeenCalledTimes(1)
    expect(retry.emailSender.send.mock.calls[0]![0].subject).toBe(firstRequest.subject)
    expect(await batchById(batch.id)).toMatchObject({ state: 'accepted' })
  })

  it('re-prepares under a new key, instead of suppressing, a batch the provider refused', async () => {
    // Refused (a rate limit) means never accepted, so the old key protects
    // nothing. Suppressing the members lost the whole day's digest.
    const { batch } = await freezeBatchAtFirstSweep(world, { refused: true })
    await forgetStoredRequest(batch.id)
    const retry = retryDeps({ activeUnsubscribeKeyVersion: 'v2' })
    retry.userLookup.getName.mockResolvedValue('Alexandra')

    await world.run(retry)

    expect(await batchById(batch.id)).toMatchObject({
      state: 'terminal',
      outcomeClass: 'superseded',
    })
    expect(await batchById(NEW_BATCH)).toMatchObject({
      state: 'accepted',
      localDate: batch.localDate,
      unsubscribeKeyVersion: 'v2',
    })
    const sent = retry.emailSender.send.mock.calls[0]![0]
    expect(sent.idempotencyKey).not.toBe(batch.providerIdempotencyKey)
    expect(sent.text).toContain('Hi Alexandra,')
    expect(sent.headers?.['List-Unsubscribe']).toContain(`v2-digest-${NEW_BATCH}`)
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'accepted' })
    }
  })

  it('does not supersede a batch the provider may have accepted', async () => {
    // The settlement is refused unless every attempt was refused, so another
    // worker's change to the batch, or an unproven refusal, never frees its
    // members for a second mail.
    const { batch } = await freezeBatchAtFirstSweep(world)

    const settled = await settleDigestBatch(world.db, {
      batchId: batch.id,
      organizationId: ORG,
      userId: USER,
      expectedContentDigest: batch.contentDigest,
      settlement: { kind: 'superseded', detectedAt: NOW },
    })

    expect(settled).toBe(false)
    expect(await batchById(batch.id)).toMatchObject({ state: 'retryable' })
  })

  it('records whether the provider refused an attempt or may have accepted it', async () => {
    const answering = (statusCode: number, name: string) =>
      createResendSenderAnswering(
        { data: null, error: { name, statusCode, message: 'rejected' } },
        () => NOW,
      )
    const rateLimited = world.deps()
    await world.run({
      ...rateLimited,
      emailSender: answering(429, 'rate_limit_exceeded'),
    } as typeof rateLimited)
    const [refused] = await world.batches()
    await world.rollBack()

    world = await openDigestWorld()
    const unavailable = world.deps()
    await world.run({
      ...unavailable,
      emailSender: answering(503, 'application_error'),
    } as typeof unavailable)
    const [possiblyAccepted] = await world.batches()

    expect(refused).toMatchObject({ state: 'retryable', outcomeClass: 'refused' })
    expect(possiblyAccepted).toMatchObject({
      state: 'retryable',
      outcomeClass: 'transient',
    })
  })
})

describe('a frozen digest that loses a row', () => {
  const expectRebuiltWithOnly = async (
    deps: ReturnType<DigestWorld['deps']>,
    batch: Awaited<ReturnType<DigestWorld['batches']>>[number],
    kept: string,
  ) => {
    expect(await batchById(batch.id)).toMatchObject({
      state: 'terminal',
      outcomeClass: 'superseded',
    })
    const rebuilt = (await world.batches()).filter((other) => other.id !== batch.id)
    expect(rebuilt).toEqual([expect.objectContaining({ state: 'accepted' })])
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).not.toBe(
      batch.providerIdempotencyKey,
    )
    const html = deps.emailSender.send.mock.calls[0]![0].html
    expect(html).toContain(kept)
    expect(html).not.toContain(kept === 'Riverside' ? 'Hillcrest' : 'Riverside')
  }

  it('sends the rest of a refused digest when one recipient row becomes ineligible', async () => {
    // A digest drops only the rows that fail.
    const { batch } = await freezeBatchAtFirstSweep(world, { refused: true })
    const deps = retryDeps()
    deps.isRecipientEligible.mockImplementation(
      async (input) => input.propertyId === PROP_A,
    )

    await world.run(deps)

    expect(await world.email(world.entries[1]!)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_ineligible',
    })
    await expectRebuiltWithOnly(deps, batch, 'Riverside')
  })

  it('sends the rest of a refused digest when one Property loses authorization', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world, { refused: true })
    const deps = retryDeps()
    deps.authorizeScope.mockImplementation(async (_org, property) => property === PROP_A)

    await world.run(deps)

    await expectRebuiltWithOnly(deps, batch, 'Riverside')
  })

  it('sends the rest of a refused digest when a member was settled elsewhere', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world, { refused: true })
    await world.setEmail(world.entries[1]!, {
      status: 'suppressed',
      suppressionReason: 'work_settled',
    })
    const deps = retryDeps()

    await world.run(deps)

    await expectRebuiltWithOnly(deps, batch, 'Riverside')
  })

  it('retires a refused digest without sending when every row drops', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world, { refused: true })
    const deps = retryDeps()
    deps.isRecipientEligible.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.batches()).toEqual([
      expect.objectContaining({
        id: batch.id,
        state: 'terminal',
        outcomeClass: 'superseded',
      }),
    ])
  })

  it('still retires the whole digest when the provider may have accepted it', async () => {
    // Re-sending the rest under a new key could deliver the digest twice.
    const { batch } = await freezeBatchAtFirstSweep(world)
    const deps = retryDeps()
    deps.isRecipientEligible.mockImplementation(
      async (input) => input.propertyId === PROP_A,
    )

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.batches()).toEqual([
      expect.objectContaining({
        id: batch.id,
        state: 'terminal',
        outcomeClass: 'invalidated',
        terminalReason: 'digest_membership_invalidated',
      }),
    ])
  })
})
