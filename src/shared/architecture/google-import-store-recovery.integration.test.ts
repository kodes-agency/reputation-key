import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { resetExecutionPolicy } from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { capabilityExecutionControl } from '#/shared/db/schema/google-content-control.schema'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import { GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS } from '#/contexts/integration/application/ports/google-import-v2-store.port'
import {
  createGoogleImportAcceptanceFixture,
  IMPORT_TEST_NOW,
  IMPORT_TEST_DAY_MS,
  IMPORT_TEST_ENCRYPTION_KEY,
} from '#/shared/testing/google-import-acceptance.test-fixtures'

import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import type { GoogleImportV2Store } from '#/contexts/integration/application/ports/google-import-v2-store.port'
import * as bindingModule from '#/contexts/property/profile/google-binding-store.server'
import * as importStoreModule from '#/contexts/integration/imports/import-store.server'
import { createTokenEncryptionAdapter } from '#/contexts/integration/infrastructure/adapters/token-encryption.adapter'
import {
  createDurableImportReferenceKeys,
  invalidationScopeFor,
} from '#/contexts/integration/infrastructure/durable-import-reference-keys'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import { member, organization, user } from '#/shared/db/schema/auth'
import { permissionVersion } from '#/shared/db/schema/dac.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import {
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { portalPageEdits } from '#/shared/db/schema/portal-publication.schema'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { googleImports } from '#/shared/db/schema/google-import.schema'
import { workItems } from '#/shared/db/schema/work-items.schema'
describe('public Google imports against the import store (PostgreSQL, fake transport)', () => {
  type Fixture = Awaited<ReturnType<typeof createFixture>>
  type Delivery = ReturnType<Fixture['deliveries']>[number]

  let lease: TestLease | undefined
  let db: Database
  let fixture: Fixture | undefined
  let controls: Array<typeof capabilityExecutionControl.$inferSelect>

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 8)
    db = createDatabase(lease.pool)
    registerAllEventSchemas()
    controls = await db.select().from(capabilityExecutionControl)
    const authority = createGoogleContentAuthorityRepository(db)
    await authority.transaction((tx) =>
      authority.allowCapability(tx, 'property.import_gbp_v2', {
        operatorId: 'acceptance-test',
        reason: 'Import acceptance fixture',
        changedAt: IMPORT_TEST_NOW,
      }),
    )
  })

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(async () => {
    try {
      await fixture?.cleanup()
    } finally {
      fixture = undefined
      resetExecutionPolicy()
      resetCapabilityPolicyStore()
      vi.restoreAllMocks()
    }
  })

  afterAll(async () => {
    try {
      if (controls) {
        if (!controls.some((row) => row.capability === 'property.import_gbp_v2')) {
          await db
            .delete(capabilityExecutionControl)
            .where(eq(capabilityExecutionControl.capability, 'property.import_gbp_v2'))
        }
        for (const row of controls) {
          await db
            .update(capabilityExecutionControl)
            .set(row)
            .where(eq(capabilityExecutionControl.capability, row.capability))
        }
      }
    } finally {
      await lease?.release()
    }
  })

  function current() {
    if (!fixture) throw new Error('Import acceptance fixture was not initialized')
    return fixture
  }

  async function start(count = 1) {
    const f = current()
    const { input } = await f.selection(count)
    const result = await f.commands().start(input, f.actor)
    return { ...result, input }
  }

  async function dispatch() {
    const f = current()
    f.queue.clear()
    const result = await f.recover()
    expect(result.itemFailures).toBe(0)
    return f.deliveries()
  }

  async function finish() {
    const f = current()
    const deliveries = await dispatch()
    expect(deliveries.length).toBeGreaterThan(0)
    for (const delivery of deliveries) await f.process(delivery)
    return deliveries
  }

  async function createFixture() {
    const orgId = `import-acceptance-${randomUUID()}`
    const userId = randomUUID()
    const otherUserId = randomUUID()
    const connectionId = randomUUID()
    const now = IMPORT_TEST_NOW
    const invalidationKeys = createDurableImportReferenceKeys({})
      .invalidationKeys(invalidationScopeFor('connection', [orgId, connectionId]))
      .map((fence) => fence.key)
    const encryptionKey = IMPORT_TEST_ENCRYPTION_KEY
    const encryption = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: encryptionKey },
    })

    await db
      .insert(organization)
      .values({ id: orgId, name: 'Import acceptance', slug: orgId, createdAt: now })
    await db.insert(user).values(
      [userId, otherUserId].map((id) => ({
        id,
        name: 'Import manager',
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    await db.insert(member).values(
      [userId, otherUserId].map((id) => ({
        id: randomUUID(),
        organizationId: orgId,
        userId: id,
        role: 'owner',
        createdAt: now,
      })),
    )
    await db
      .insert(permissionVersion)
      .values({ organizationId: orgId, version: 1 })
      .onConflictDoNothing()
    await db.insert(googleConnections).values({
      id: connectionId,
      organizationId: orgId,
      googleSubject: randomUUID(),
      encryptedAccessToken: encryption.encrypt('acceptance-access'),
      encryptedRefreshToken: encryption.encrypt('acceptance-refresh'),
      tokenExpiresAt: new Date(now.getTime() + IMPORT_TEST_DAY_MS),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      connectedBy: userId,
      credentialAuthorizedBy: userId,
      credentialAuthorizedAt: now,
      visibility: 'organization',
      createdAt: now,
      updatedAt: now,
    })

    const actor = (
      await resolveMemberAuthContextWithDatabase(db, {
        memberRole: 'owner',
        organizationId: orgId,
        userId,
      })
    ).context
    const otherActor = (
      await resolveMemberAuthContextWithDatabase(db, {
        memberRole: 'owner',
        organizationId: orgId,
        userId: otherUserId,
      })
    ).context

    const originalStoreFactory = importStoreModule.createImportStore
    const originalBindingFactory = bindingModule.createPropertyGoogleBindingStore
    let binding: ReturnType<typeof originalBindingFactory> | undefined
    let store: GoogleImportV2Store | undefined
    const beforeWrite = vi.fn(async () => undefined)
    const afterWrite = vi.fn(async () => undefined)
    const createBoundProperty = vi.fn<
      ReturnType<typeof originalBindingFactory>['createBoundProperty']
    >(async (input) => {
      if (!binding) throw new Error('Property binding was not composed')
      await beforeWrite()
      const result = await binding.createBoundProperty(input)
      await afterWrite()
      return result
    })
    // Observe the root's real stores; only the crash/pause points are substituted.
    vi.spyOn(bindingModule, 'createPropertyGoogleBindingStore').mockImplementation(
      (...args) => {
        binding = originalBindingFactory(...args)
        return { ...binding, createBoundProperty }
      },
    )
    vi.spyOn(importStoreModule, 'createImportStore').mockImplementation((...args) => {
      store = originalStoreFactory(...args)
      return store
    })
    const runtime = createGoogleImportAcceptanceFixture({
      db,
      pool: db.$client,
      orgId,
      connectionId,
      actor,
      otherActor,
    })
    return {
      ...runtime,
      beforeWrite,
      afterWrite,
      createBoundProperty,
      get binding() {
        if (!binding) throw new Error('Property binding was not composed')
        return binding
      },
      get store() {
        if (!store) throw new Error('Import store was not composed')
        return store
      },
      propertyRows: () =>
        db.select().from(properties).where(eq(properties.organizationId, orgId)),
      async cleanup() {
        await runtime.close()
        await db.delete(workItems).where(eq(workItems.organizationId, orgId))
        await db.delete(googleImports).where(eq(googleImports.organizationId, orgId))
        await db
          .delete(propertyPortalBrandContents)
          .where(eq(propertyPortalBrandContents.organizationId, orgId))
        await db
          .delete(propertyPortalBrandProfiles)
          .where(eq(propertyPortalBrandProfiles.organizationId, orgId))
        await db.delete(portalPageEdits).where(eq(portalPageEdits.organizationId, orgId))
        await db.delete(properties).where(eq(properties.organizationId, orgId))
        await db
          .delete(idempotencyReceipts)
          .where(sql`${idempotencyReceipts.payload}->>'organizationId' = ${orgId}`)
        await db
          .delete(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'google_import_discovery'),
              inArray(idempotencyReceipts.key, invalidationKeys),
            ),
          )
        await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, orgId))
        await db
          .delete(googleConnections)
          .where(eq(googleConnections.organizationId, orgId))
        await executeWithLastOwnerGuardDisabled(db, [
          sql`DELETE FROM member WHERE "organizationId" = ${orgId}`,
        ])
        await db.delete(user).where(inArray(user.id, [userId, otherUserId]))
        await db
          .delete(permissionVersion)
          .where(eq(permissionVersion.organizationId, orgId))
        await deleteTestOrganizations(db, [orgId])
      },
      async changeConnection(values: Partial<typeof googleConnections.$inferInsert>) {
        await db
          .update(googleConnections)
          .set(values)
          .where(
            and(
              eq(googleConnections.id, connectionId),
              eq(googleConnections.organizationId, orgId),
            ),
          )
      },
    }
  }

  async function loseWorker(delivery: Delivery) {
    const f = current()
    const claimFence = randomUUID()
    const claim = await f.store.claimItem({
      ...delivery,
      attemptOrdinal: 1,
      claimFence,
      now: f.clock(),
      leaseExpiresAt: new Date(f.clock().getTime() + GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS),
    })
    expect(claim.kind).toBe('claimed')
    if (claim.kind !== 'claimed') throw new Error('Worker did not acquire its claim')
    f.advance(GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS + 1)
    f.queue.clear()
    await f.restart()
    return claim.item
  }

  it('recovers empty transport after two worker deaths using persisted attempts', async () => {
    const f = current()
    const { importJobId } = await start()
    for (let attempt = 1; attempt <= 2; attempt++) {
      const [delivery] = await dispatch()
      if (!delivery) throw new Error('Database recovery did not recreate delivery')
      const claim = await loseWorker(delivery)
      expect(claim.attemptOrdinal).toBe(attempt)
    }
    await finish()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed',
      counts: { imported: 1 },
    })
    expect(await f.propertyRows()).toHaveLength(1)
  })

  it('bounds repeated worker deaths and allows a freshly authorized Retry', async () => {
    const f = current()
    const { importJobId } = await start()
    let itemId = ''
    for (let attempt = 1; attempt <= 5; attempt++) {
      const [delivery] = await dispatch()
      if (!delivery) throw new Error('Database recovery did not recreate delivery')
      itemId = delivery.itemId
      expect((await loseWorker(delivery)).attemptOrdinal).toBe(attempt)
    }
    expect(await dispatch()).toEqual([])
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'failed',
      canRetry: true,
      items: [{ itemId, outcomeCode: 'temporarily_unavailable', retryable: true }],
    })
    expect(await f.propertyRows()).toEqual([])
    const retry = { itemId, retryRequestId: randomUUID(), expectedRetryRevision: 0 }
    expect(await f.commands().retry(retry, f.actor)).toMatchObject({
      importJobId,
      retryRevision: 1,
      replayed: false,
    })
    expect(await f.commands().retry(retry, f.actor)).toMatchObject({
      importJobId,
      retryRevision: 1,
      replayed: true,
    })
    await finish()
    expect(await f.propertyRows()).toHaveLength(1)
  })

  it.each(['reaper', 'worker takeover'] as const)(
    'keeps the new claim when %s wins recovery and rejects the old completion',
    async (winner) => {
      const f = current()
      const { importJobId } = await start()
      const [original] = await dispatch()
      if (!original) throw new Error('Initial delivery missing')
      const stale = await loseWorker(original)
      const [replacement] = winner === 'reaper' ? await dispatch() : [original]
      if (!replacement) throw new Error('Replacement delivery missing')
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      f.beforeWrite.mockImplementationOnce(async () => {
        entered.resolve()
        await release.promise
      })
      const processing = f.process(replacement)
      try {
        await Promise.race([
          entered.promise,
          processing.then(() => {
            throw new Error('Worker ended before reaching the Property effect')
          }),
        ])
        expect(await f.recover()).toMatchObject({
          claimsReleased: 0,
          itemsDispatched: 0,
        })
      } finally {
        // Always let the worker release its transaction before fixture cleanup.
        release.resolve()
      }
      const oldCompletion = f.store.completeClaim({
        organizationId: f.orgId,
        itemId: stale.itemId,
        retryRevision: stale.retryRevision,
        dispatchEpoch: stale.dispatchEpoch,
        claimFence: stale.claimFence,
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
        now: f.clock(),
      })
      await processing
      expect(await oldCompletion).toBe('lost')
      expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
        status: 'completed',
        counts: { imported: 1 },
      })
      expect(await f.propertyRows()).toHaveLength(1)
    },
  )

  it('recovers a committed Property receipt after the worker loses its result', async () => {
    const f = current()
    const { importJobId } = await start()
    f.afterWrite.mockRejectedValueOnce(
      Object.assign(new Error('Worker lost Property result'), { code: '08006' }),
    )
    const [delivery] = await dispatch()
    if (!delivery) throw new Error('Initial delivery missing')
    await expect(f.process(delivery)).rejects.toThrow('Worker lost Property result')
    expect(await f.propertyRows()).toHaveLength(1)
    f.advance(60_001)
    await f.restart()
    await finish()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed',
      counts: { imported: 1 },
    })
    expect(await f.propertyRows()).toHaveLength(1)
    expect(f.createBoundProperty).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'disconnect'] as const)(
    'fences pending deliveries after %s',
    async (action) => {
      const f = current()
      const { importJobId, input } = await start(2)
      const deliveries = await dispatch()
      if (action === 'cancel') {
        await f.commands().cancel(importJobId, f.actor)
        await f.commands().cancel(importJobId, f.actor)
        await expect(f.commands().start(input, f.actor)).resolves.toEqual({
          importJobId,
          replayed: true,
        })
      } else {
        expect(await f.disconnect()).toMatchObject({ status: 'disconnected' })
      }
      for (const delivery of deliveries) await f.process(delivery)
      expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
        status: 'cancelled',
        processedCount: 2,
        counts: { cancelled: 2, pending: 0, processing: 0 },
      })
      expect(await f.propertyRows()).toEqual([])
      expect(f.createBoundProperty).not.toHaveBeenCalled()
    },
  )

  it('returns controlled missing history after retention while preserving the imported Property', async () => {
    const f = current()
    const { importJobId, input } = await start()
    await finish()
    const status = await f.commands().status(importJobId, f.actor)
    expect(status).toMatchObject({ status: 'completed', processedCount: 1 })
    if (!status.purgeAt) throw new Error('Terminal import has no retention deadline')
    f.advance(Date.parse(status.purgeAt) - f.clock().getTime() - 1)
    await f.sweep()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed',
    })
    f.advance(1)
    expect(await f.sweep()).toMatchObject({ parentsPurged: 1 })
    await f.restart()
    await expect(f.commands().status(importJobId, f.actor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    await expect(f.commands().recover(input.requestId, f.actor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    expect(await f.propertyRows()).toHaveLength(1)
  })

  it('asks for fresh confirmation after the effect deadline without extending the old import', async () => {
    const f = current()
    const { importJobId } = await start()
    f.advance(IMPORT_TEST_DAY_MS)
    expect(await dispatch()).toEqual([])
    const status = await f.commands().status(importJobId, f.actor)
    expect(status).toMatchObject({
      status: 'failed',
      items: [{ outcomeCode: 'temporarily_unavailable' }],
    })
    const item = status.items[0]
    if (!item) throw new Error('Expired import item missing')
    expect(
      await f.commands().retry(
        {
          itemId: item.itemId,
          retryRequestId: randomUUID(),
          expectedRetryRevision: item.retryRevision,
        },
        f.actor,
      ),
    ).toEqual({ confirmationRequired: true })
    expect(await f.propertyRows()).toEqual([])
    expect(await dispatch()).toEqual([])
  })

  it('keeps all locations of a selection larger than one worker batch visible and releases all retained history', async () => {
    const f = current()
    f.addLocations(203)
    const { input } = await f.selection(205)
    expect(input.items).toHaveLength(205)
    const { importJobId } = await f.commands().start(input, f.actor)
    expect(
      await f.commands().start({ ...input, items: [...input.items].reverse() }, f.actor),
    ).toEqual({ importJobId, replayed: true })
    const queued = await f.commands().status(importJobId, f.actor)
    expect(queued).toMatchObject({
      totalCount: 205,
      processedCount: 0,
      counts: { pending: 205 },
    })
    expect(queued.items).toHaveLength(205)
    const seen = new Set<string>()
    for (let page = 0; page < 3; page++) {
      const deliveries = await dispatch()
      expect(deliveries.length).toBeLessThanOrEqual(100)
      for (const delivery of deliveries) seen.add(delivery.itemId)
    }
    expect(seen.size).toBe(205)
    await f.commands().cancel(importJobId, f.actor)
    const terminal = await f.commands().status(importJobId, f.actor)
    expect(terminal).toMatchObject({
      status: 'cancelled',
      totalCount: 205,
      processedCount: 205,
      counts: { pending: 0, processing: 0, cancelled: 205 },
    })
    if (!terminal.purgeAt) throw new Error('Cancelled import has no retention deadline')
    f.advance(Date.parse(terminal.purgeAt) - f.clock().getTime() - 1)
    expect(await f.sweep()).toMatchObject({ parentsPurged: 0 })
    expect((await f.commands().status(importJobId, f.actor)).items).toHaveLength(205)
    f.advance(1)
    const sweep = await f.sweep()
    expect(sweep.parentsPurged).toBe(1)
    await expect(f.commands().status(importJobId, f.actor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    await expect(f.commands().recover(input.requestId, f.actor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    expect(await f.store.listPurgeCandidates(f.clock(), 100)).toEqual([])
  })

  it('bounds durable attempts, reauthorizes manual Retry and never renews the first terminal retention clock', async () => {
    const f = current()
    const { importJobId } = await start()
    f.beforeWrite.mockRejectedValue(
      Object.assign(new Error('Property store unavailable'), { code: '08006' }),
    )
    for (let attempt = 1; attempt <= 5; attempt++) {
      const [delivery] = await dispatch()
      if (!delivery) throw new Error('Retry appointment lost a pending item')
      if (attempt < 5) {
        await expect(f.process(delivery)).rejects.toThrow('Property store unavailable')
      } else {
        await f.process(delivery)
      }
      f.advance(60_001)
    }
    const failed = await f.commands().status(importJobId, f.actor)
    expect(failed).toMatchObject({
      status: 'failed',
      canRetry: true,
      counts: { failed: 1 },
    })
    const item = failed.items[0]
    if (!item || !failed.purgeAt)
      throw new Error('Bounded failure lost its retry or retention state')
    const request = {
      itemId: item.itemId,
      retryRequestId: randomUUID(),
      expectedRetryRevision: item.retryRevision,
    }
    await expect(f.commands().retry(request, f.otherActor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    expect(await f.commands().retry(request, f.actor)).toEqual({
      importJobId,
      retryRevision: 1,
      replayed: false,
    })
    expect(await f.commands().retry(request, f.actor)).toEqual({
      importJobId,
      retryRevision: 1,
      replayed: true,
    })
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      purgeAt: failed.purgeAt,
      counts: { pending: 1, failed: 0 },
    })
    f.beforeWrite.mockResolvedValue(undefined)
    await finish()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed',
      purgeAt: failed.purgeAt,
      counts: { imported: 1 },
    })
    expect(await f.propertyRows()).toHaveLength(1)
  })

  it('adopts the committed Property receipt when cancellation races a lost worker result', async () => {
    const f = current()
    const { importJobId } = await start()
    f.afterWrite.mockRejectedValueOnce(
      Object.assign(new Error('Property result lost'), { code: '08006' }),
    )
    const [delivery] = await dispatch()
    if (!delivery) throw new Error('Initial delivery missing')
    await expect(f.process(delivery)).rejects.toThrow('Property result lost')
    const status = await f.commands().cancel(importJobId, f.actor)
    expect(status).toMatchObject({
      status: 'completed',
      counts: { imported: 1, cancelled: 0 },
    })
    await f.process(delivery)
    expect(await f.propertyRows()).toHaveLength(1)
    expect(f.createBoundProperty).toHaveBeenCalledOnce()
  })

  it('refuses an old claim fence even when a caller supplies the current dispatch epoch', async () => {
    const f = current()
    const { importJobId } = await start()
    const [delivery] = await dispatch()
    if (!delivery) throw new Error('Initial delivery missing')
    const oldFence = randomUUID()
    const first = await f.store.claimItem({
      ...delivery,
      attemptOrdinal: 1,
      claimFence: oldFence,
      now: f.clock(),
      leaseExpiresAt: new Date(f.clock().getTime() + 60_000),
    })
    if (first.kind !== 'claimed') throw new Error('First worker did not acquire claim')
    f.advance(60_001)
    const takeover = await f.store.claimItem({
      ...delivery,
      attemptOrdinal: 1,
      claimFence: randomUUID(),
      now: f.clock(),
      leaseExpiresAt: new Date(f.clock().getTime() + 60_000),
    })
    if (takeover.kind !== 'claimed')
      throw new Error('Replacement worker did not acquire claim')
    expect(takeover.item.attemptOrdinal).toBe(2)
    const scope = {
      organizationId: f.orgId,
      itemId: delivery.itemId,
      retryRevision: 0,
      dispatchEpoch: takeover.item.dispatchEpoch,
      now: f.clock(),
    }
    expect(await f.store.releaseClaimForRetry({ ...scope, claimFence: oldFence })).toBe(
      'lost',
    )
    expect(
      await f.store.terminalizeItem({
        ...scope,
        authority: {
          kind: 'claim',
          dispatchEpoch: takeover.item.dispatchEpoch,
          claimFence: oldFence,
        },
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
      }),
    ).toBe('lost')
    const effect = vi.fn(async () => 'current effect')
    expect(
      await f.store.runClaimedEffect(
        {
          ...scope,
          attemptOrdinal: takeover.item.attemptOrdinal,
          claimFence: takeover.item.claimFence,
        },
        effect,
      ),
    ).toEqual({ kind: 'executed', value: 'current effect' })
    expect(effect).toHaveBeenCalledOnce()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      processedCount: 0,
      counts: { processing: 1 },
    })
  })
})
