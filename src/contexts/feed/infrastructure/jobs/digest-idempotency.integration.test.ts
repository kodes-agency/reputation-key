// A digest's provider key and frozen request against real PostgreSQL: the key
// is bound to the persisted batch, a retry reproduces it and the exact
// membership, and a retry whose content changed fails closed instead of
// reusing a key the provider already knows.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationDigestBatches } from '#/shared/db/schema'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { startDigestAttempt } from '../../email/notification-digest-batch.server'
import { digestProviderRequest } from '../digest-batch-identity'
import { freezeBatchAtFirstSweep } from './digest-retry-seed'
import {
  HOUR,
  NOW,
  openDigestWorld,
  ORG,
  PROP_A,
  PROP_B,
  USER,
  type DigestWorld,
} from './digest-job-test-deps'

const LATE_PROPERTY = '33333333-3333-4333-8333-333333333333'

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld()
})

afterEach(async () => {
  await world.rollBack()
})

const retryDeps = (options: Parameters<DigestWorld['deps']>[0] = {}) =>
  world.deps({ now: new Date(NOW.getTime() + HOUR), ...options })

/** A batch frozen before its provider request was stored is re-rendered on a retry. */
const forgetStoredRequest = (batchId: string, values = {}) =>
  world.db
    .update(notificationDigestBatches)
    .set({ providerRequest: null, ...values })
    .where(eq(notificationDigestBatches.id, batchId))

describe('digest idempotency', () => {
  it('uses a bounded opaque key bound to the immutable batch', async () => {
    const deps = world.deps()

    await world.run(deps)

    const { idempotencyKey } = deps.emailSender.send.mock.calls[0]![0]
    expect(idempotencyKey).toMatch(/^rk-digest-v2:[a-f0-9]{64}$/)
    expect(idempotencyKey).not.toContain(PROP_A)
    expect(idempotencyKey).not.toContain(PROP_B)
    const [batch] = await world.batches()
    expect(batch!.providerIdempotencyKey).toBe(idempotencyKey)
  })

  it('reuses the persisted key and exact membership on a retry', async () => {
    const { batch, firstRequest } = await freezeBatchAtFirstSweep(world)
    await seedProperty(world.db, {
      id: LATE_PROPERTY,
      organizationId: ORG,
      name: 'Lakeside',
    })
    const late = await world.entry({ property: LATE_PROPERTY })
    const retry = retryDeps()

    await world.run(retry)

    expect(retry.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
      batch.providerIdempotencyKey,
    )
    expect(retry.emailSender.send.mock.calls[0]![0].html).toBe(firstRequest.html)
    expect(retry.emailSender.send.mock.calls[0]![0].html).not.toContain('Lakeside')
    expect(await world.email(late)).toMatchObject({ status: 'pending' })
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'accepted' })
    }
    expect(await world.batches()).toHaveLength(1)
  })

  it('reproduces the unsubscribe header with the persisted key after rotation', async () => {
    const { batch, firstRequest } = await freezeBatchAtFirstSweep(world)
    await forgetStoredRequest(batch.id)
    const retry = retryDeps({ activeUnsubscribeKeyVersion: 'v2' })

    await world.run(retry)

    expect(retry.activeOneClickUnsubscribeKeyVersion).not.toHaveBeenCalled()
    expect(retry.oneClickUnsubscribeUrl).toHaveBeenCalledWith(
      { kind: 'digest', id: batch.id },
      'v1',
    )
    expect(retry.emailSender.send.mock.calls[0]![0].headers).toEqual(firstRequest.headers)
  })

  it('retries a pre-unsubscribe batch with its exact legacy header', async () => {
    const { batch, firstRequest } = await freezeBatchAtFirstSweep(world)
    const legacyHeaders = {
      'List-Unsubscribe': '<https://app.example.com/settings/notifications>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }
    await forgetStoredRequest(batch.id, {
      unsubscribeKeyVersion: 'legacy',
      contentDigest: digestProviderRequest({ ...firstRequest, headers: legacyHeaders }),
    })
    const retry = retryDeps()

    await world.run(retry)

    expect(retry.oneClickUnsubscribeUrl).not.toHaveBeenCalled()
    expect(retry.emailSender.send.mock.calls[0]![0].headers).toEqual(legacyHeaders)
    expect(await world.batches()).toEqual([
      expect.objectContaining({ id: batch.id, state: 'accepted' }),
    ])
  })

  it('records that an attempt started before it calls the provider', async () => {
    const deps = world.deps()
    let batchWhenCalled: Awaited<ReturnType<DigestWorld['batches']>> = []
    deps.emailSender.send.mockImplementation(async () => {
      batchWhenCalled = await world.batches()
      return { kind: 'accepted', providerMessageId: 'provider-1', acceptedAt: NOW }
    })

    await world.run(deps)

    expect(batchWhenCalled).toEqual([
      expect.objectContaining({
        state: 'prepared',
        outcomeClass: 'in_flight',
        attemptedAt: NOW,
      }),
    ])
  })

  it('starts no attempt for a batch that closed first', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await world.db
      .update(notificationDigestBatches)
      .set({ state: 'terminal', outcomeClass: 'invalidated' })
      .where(eq(notificationDigestBatches.id, batch.id))

    const started = await startDigestAttempt(world.db, {
      batchId: batch.id,
      organizationId: ORG,
      userId: USER,
      startedAt: new Date(NOW.getTime() + HOUR),
    })

    expect(started).toBe(false)
    expect(await world.batches()).toEqual([
      expect.objectContaining({
        state: 'terminal',
        outcomeClass: 'invalidated',
        attemptedAt: NOW,
      }),
    ])
  })

  it('settles the batch and every exact member together', async () => {
    const deps = world.deps()

    await world.run(deps)

    const batches = await world.batches()
    expect(batches).toEqual([
      expect.objectContaining({
        state: 'accepted',
        providerMessageId: expect.any(String),
      }),
    ])
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({
        status: 'accepted',
        providerMessageId: batches[0]!.providerMessageId,
      })
    }
  })

  it('fails closed instead of reusing a provider key when retry content changes', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await forgetStoredRequest(batch.id)
    const retry = retryDeps()
    retry.userLookup.getName.mockResolvedValue('A different recipient name')

    await world.run(retry)

    expect(retry.emailSender.send).not.toHaveBeenCalled()
    expect(await world.batches()).toEqual([
      expect.objectContaining({
        id: batch.id,
        state: 'terminal',
        outcomeClass: 'content_mismatch',
      }),
    ])
    expect(retry.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: batch.id }),
      'Digest retry blocked because provider-visible content changed',
    )
  })

  it('keeps failing closed when the provider may have accepted the last attempt', async () => {
    // A 5xx, a timeout or a lost response may follow an accepted message, so
    // a new key could mail the digest twice. The frozen key stays binding.
    const { batch } = await freezeBatchAtFirstSweep(world)
    await forgetStoredRequest(batch.id, { state: 'retryable', retryCount: 1 })
    const retry = retryDeps()
    retry.userLookup.getName.mockResolvedValue('A different recipient name')

    await world.run(retry)

    expect(retry.emailSender.send).not.toHaveBeenCalled()
    const batches = await world.batches()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ id: batch.id, outcomeClass: 'content_mismatch' })
  })

  it('terminates an open batch when a member loses delivery authorization', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    const retry = retryDeps()
    retry.authorizeScope.mockImplementation(async (_org, property) => property === PROP_A)

    await world.run(retry)

    expect(retry.emailSender.send).not.toHaveBeenCalled()
    expect(await world.batches()).toEqual([
      expect.objectContaining({
        id: batch.id,
        state: 'terminal',
        outcomeClass: 'invalidated',
        terminalReason: 'digest_authorization_changed',
      }),
    ])
  })
})
