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
import { z } from 'zod/v4'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { resetExecutionPolicy } from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { capabilityExecutionControl } from '#/shared/db/schema/google-content-control.schema'
import { googleImports, googleImportItems } from '#/shared/db/schema/google-import.schema'
import { workItems } from '#/shared/db/schema/work-items.schema'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import {
  createGoogleImportAcceptanceFixture,
  IMPORT_TEST_NOW,
  IMPORT_TEST_DAY_MS,
  IMPORT_TEST_ENCRYPTION_KEY,
} from '#/shared/testing/google-import-acceptance.test-fixtures'
import { PROPERTY_IMPORT_RETENTION_RELEASED_EVENT } from '#/contexts/integration/application/google-import-contract'

import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import type { GoogleImportStore } from '#/contexts/integration/application/ports/google-import-store.port'
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

const releasePayload = z.object({
  organizationId: z.string(),
  importJobId: z.string(),
  idempotencyKeys: z.array(z.string()),
})

describe('single-root Google import checkpoints (PostgreSQL)', () => {
  type Fixture = Awaited<ReturnType<typeof createFixture>>
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
        reason: 'Import checkpoint acceptance fixture',
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

    const originalBindingFactory = bindingModule.createPropertyGoogleBindingStore
    let binding: ReturnType<typeof originalBindingFactory> | undefined
    let store: GoogleImportStore | undefined
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
    const originalStoreFactory = importStoreModule.createImportStore
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

  function current() {
    if (!fixture) throw new Error('Import checkpoint fixture was not initialized')
    return fixture
  }

  async function start(count: number) {
    const f = current()
    if (count > 2) f.addLocations(count - 2)
    const { input } = await f.selection(count)
    expect(input.items).toHaveLength(count)
    const { importJobId } = await f.commands().start(input, f.actor)
    const progress = await f.commands().status(importJobId, f.actor)
    expect(progress.items).toHaveLength(count)
    return { importJobId, input, itemIds: progress.items.map((item) => item.itemId) }
  }

  async function fail(itemId: string) {
    const f = current()
    expect(
      await f.store.terminalizeItem({
        organizationId: f.orgId,
        itemId,
        retryRevision: 0,
        authority: { kind: 'pending', dispatchEpoch: 0 },
        outcomeCode: 'internal_error',
        retainRetryState: false,
        now: f.clock(),
      }),
    ).toBe('completed')
  }

  it('retains all history when an early hundred finish, starting the one retention clock only at final completion', async () => {
    const f = current()
    const { importJobId, input, itemIds } = await start(205)
    for (const itemId of itemIds.slice(0, 100)) await fail(itemId)
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      totalCount: 205,
      processedCount: 100,
      counts: { pending: 105, failed: 100 },
      purgeAt: null,
    })

    f.advance(30 * IMPORT_TEST_DAY_MS + 1)
    expect(await f.store.listPurgeCandidates(f.clock(), 100)).toEqual([])
    const unfinished = await f.commands().status(importJobId, f.actor)
    expect(unfinished.items).toHaveLength(205)
    expect(
      unfinished.items.filter((item) => item.outcomeCode === 'internal_error'),
    ).toHaveLength(100)
    expect(unfinished.purgeAt).toBeNull()
    await expect(f.commands().start(input, f.actor)).resolves.toEqual({
      importJobId,
      replayed: true,
    })

    for (const itemId of itemIds.slice(100)) await fail(itemId)
    const finalAt = f.clock().getTime()
    const purgeAt = new Date(finalAt + 30 * IMPORT_TEST_DAY_MS).toISOString()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'failed',
      totalCount: 205,
      processedCount: 205,
      counts: { pending: 0, processing: 0, failed: 205 },
      purgeAt,
    })
    expect(
      await f.store.listPurgeCandidates(new Date(Date.parse(purgeAt) - 1), 100),
    ).toEqual([])
    expect(await f.store.listPurgeCandidates(new Date(purgeAt), 100)).toEqual([
      { organizationId: f.orgId, importJobId, deletionFence: 0 },
    ])
    expect(await f.propertyRows()).toEqual([])
  })

  it('derives exact grouped progress when final sibling transitions race and preserves the first terminal clock', async () => {
    const f = current()
    const { importJobId, itemIds } = await start(4)
    for (const itemId of itemIds.slice(0, 2)) await fail(itemId)
    f.advance(60_000)
    await Promise.all(itemIds.slice(2).map(fail))
    const completed = await f.commands().status(importJobId, f.actor)
    const purgeAt = new Date(f.clock().getTime() + 30 * IMPORT_TEST_DAY_MS).toISOString()
    expect(completed).toMatchObject({
      status: 'failed',
      totalCount: 4,
      processedCount: 4,
      counts: {
        pending: 0,
        processing: 0,
        imported: 0,
        relinked: 0,
        already_exists: 0,
        failed: 4,
        cancelled: 0,
      },
      purgeAt,
    })
    expect(completed.items.filter((item) => item.status === 'failed')).toHaveLength(4)
    f.advance(IMPORT_TEST_DAY_MS)
    const [itemId] = itemIds
    if (!itemId) throw new Error('Terminal import lost its checkpoint identity')
    expect(
      await f.store.terminalizeItem({
        organizationId: f.orgId,
        itemId,
        retryRevision: 0,
        authority: { kind: 'pending', dispatchEpoch: 0 },
        outcomeCode: 'internal_error',
        retainRetryState: false,
        now: f.clock(),
      }),
    ).toBe('lost')
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      processedCount: 4,
      counts: completed.counts,
      purgeAt,
    })
  })

  it('rolls a failed retention release back, then atomically removes the whole import with bounded release facts', async () => {
    const f = current()
    const { importJobId, input, itemIds } = await start(205)
    const cancelled = await f.commands().cancel(importJobId, f.actor)
    if (!cancelled.purgeAt) throw new Error('Terminal import has no retention deadline')
    f.advance(Date.parse(cancelled.purgeAt) - f.clock().getTime())
    const [candidate] = await f.store.listPurgeCandidates(f.clock(), 100)
    if (!candidate) throw new Error('Due whole import was not offered for retention')
    const [existingEvent] = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, f.orgId))
    if (!existingEvent) throw new Error('Import commit has no durable dispatch fact')
    const purgeInput = {
      organizationId: f.orgId,
      importJobId,
      expectedDeletionFence: candidate.deletionFence,
      now: f.clock(),
    }
    await expect(
      f.store.purgeParent({ ...purgeInput, outboxEventId: existingEvent.id }),
    ).rejects.toMatchObject({
      cause: { code: '23505' },
    })
    expect(await f.store.listPurgeCandidates(f.clock(), 100)).toEqual([candidate])
    expect(await f.store.findReplay(f.orgId, input.requestId)).toMatchObject({
      importJobId,
      initiatedBy: f.actor.userId,
    })
    const retained = await f.store.getOperatorProgress(f.orgId, importJobId)
    expect(retained).toMatchObject({
      totalCount: 205,
      processedCount: 205,
      counts: { cancelled: 205 },
    })
    expect(retained?.items).toHaveLength(205)
    expect(await releaseFacts()).toEqual([])

    const outboxEventId = randomUUID()
    expect(await f.store.purgeParent({ ...purgeInput, outboxEventId })).toBe('purged')
    expect(await f.store.findReplay(f.orgId, input.requestId)).toBeNull()
    expect(await f.store.getOperatorProgress(f.orgId, importJobId)).toBeNull()
    expect(await f.store.listPendingDispatchItems(f.orgId, importJobId)).toBeNull()
    expect(
      await db
        .select()
        .from(googleImports)
        .where(eq(googleImports.organizationId, f.orgId)),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(googleImportItems)
        .where(eq(googleImportItems.organizationId, f.orgId)),
    ).toEqual([])
    const facts = await releaseFacts()
    expect(facts).toHaveLength(3)
    expect(facts.some((fact) => fact.id === outboxEventId)).toBe(true)
    const released: string[] = []
    for (const fact of facts) {
      const valid = validateEventPayload(fact.eventType, fact.eventVersion, fact.payload)
      const payload = releasePayload.parse(valid)
      expect(payload).toMatchObject({ organizationId: f.orgId, importJobId })
      expect(payload.idempotencyKeys.length).toBeGreaterThan(0)
      expect(payload.idempotencyKeys.length).toBeLessThanOrEqual(100)
      released.push(...payload.idempotencyKeys)
    }
    expect(released.sort()).toEqual([...itemIds].sort())
    expect(new Set(released).size).toBe(205)
    expect(
      await f.store.purgeParent({ ...purgeInput, outboxEventId: randomUUID() }),
    ).toBe('lost')
    expect(await releaseFacts()).toHaveLength(3)
  })

  async function releaseFacts() {
    const f = current()
    return db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, f.orgId),
          eq(outboxEvents.eventType, PROPERTY_IMPORT_RETENTION_RELEASED_EVENT),
        ),
      )
  }
})
