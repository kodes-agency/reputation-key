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
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { capabilityExecutionControl } from '#/shared/db/schema/google-content-control.schema'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import {
  createGoogleImportAcceptanceFixture,
  IMPORT_TEST_NOW,
  IMPORT_TEST_DAY_MS,
  IMPORT_TEST_REFERENCE_KEYS,
  IMPORT_TEST_ENCRYPTION_KEY,
} from '#/shared/testing/google-import-acceptance.test-fixtures'

import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import type { GoogleImportV2Store } from '#/contexts/integration/application/ports/google-import-v2-store.port'
import * as bindingModule from '#/contexts/property/infrastructure/property-google-binding-store'
import * as importStoreModule from '#/contexts/integration/imports/import-store.server'
import { createTokenEncryptionAdapter } from '#/contexts/integration/infrastructure/adapters/token-encryption.adapter'
import {
  createDurableImportReferenceKeys,
  invalidationScopeFor,
} from '#/contexts/integration/infrastructure/durable-import-reference-keys'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
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
    const keys = createVersionedHmacKeyring(IMPORT_TEST_REFERENCE_KEYS)
    const invalidationKeys = createDurableImportReferenceKeys({ keys })
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
        keys.dispose()
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

  it('imports a valid selection once and reports item progress through the public API', async () => {
    const f = current()
    const { importJobId } = await start(2)
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'queued',
      totalCount: 2,
      processedCount: 0,
      counts: { pending: 2 },
    })
    const deliveries = await finish()
    for (const delivery of deliveries) await f.process(delivery)
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed',
      processedCount: 2,
      counts: { pending: 0, processing: 0, imported: 2 },
    })
    expect(await f.propertyRows()).toHaveLength(2)
    expect(f.createBoundProperty).toHaveBeenCalledTimes(2)
  })

  it.each(['reauthentication', 'connection authority', 'suspension'] as const)(
    'refuses a selection captured before %s without writing an import or Property',
    async (change) => {
      const f = current()
      const { input } = await f.selection()
      if (change === 'reauthentication')
        await f.changeConnection({ status: 'reauth_required' })
      if (change === 'connection authority')
        await f.changeConnection({ accessVersion: 2 })
      if (change === 'suspension') await f.suspend(true)
      await expect(f.commands().start(input, f.actor)).rejects.toMatchObject({
        code:
          change === 'reauthentication' ? 'reauthentication_required' : 'unauthorized',
      })
      await expect(f.commands().recover(input.requestId, f.actor)).rejects.toMatchObject({
        code: 'invalid_reference',
      })
      expect(await f.propertyRows()).toEqual([])
      expect(f.createBoundProperty).not.toHaveBeenCalled()
      expect(await dispatch()).toEqual([])
    },
  )

  it.each(['reauthentication', 'connection authority', 'suspension'] as const)(
    'stops queued work when %s changes after confirmation',
    async (change) => {
      const f = current()
      const { importJobId } = await start()
      if (change === 'reauthentication')
        await f.changeConnection({ status: 'reauth_required' })
      if (change === 'connection authority')
        await f.changeConnection({ accessVersion: 2 })
      if (change === 'suspension') await f.suspend(true)
      await finish()
      expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
        status: change === 'reauthentication' ? 'failed' : 'cancelled',
        processedCount: 1,
        counts: {
          pending: 0,
          processing: 0,
          failed: change === 'reauthentication' ? 1 : 0,
          cancelled: change === 'reauthentication' ? 0 : 1,
        },
        items: [
          {
            status: change === 'reauthentication' ? 'failed' : 'cancelled',
            userAction: 'none',
            outcomeCode:
              change === 'reauthentication'
                ? 'reconnect_required'
                : change === 'suspension'
                  ? 'policy_disabled'
                  : 'authorization_changed',
          },
        ],
      })
      expect(await f.propertyRows()).toEqual([])
      expect(f.createBoundProperty).not.toHaveBeenCalled()
    },
  )

  async function disconnectedProperty() {
    const f = current()
    await start()
    await finish()
    const [row] = await f.propertyRows()
    if (!row) throw new Error('Initial import did not create a Property')
    const summary = await f.binding.disconnect({
      organizationId: organizationId(f.orgId),
      propertyId: propertyId(row.id),
      expectedSourceEpoch: row.sourceEpoch,
      expectedProfileVersion: row.profileVersion,
      now: f.clock(),
    })
    return { row, summary }
  }

  it('relinks a disconnected Property once without creating another Property', async () => {
    const f = current()
    await disconnectedProperty()
    const { input } = await f.selection()
    expect(input.items[0]?.action).toBe('relink')
    const { importJobId } = await f.commands().start(input, f.actor)
    await finish()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed',
      counts: { relinked: 1, imported: 0 },
    })
    expect(await f.propertyRows()).toHaveLength(1)
  })

  it('refuses a relink selection after another relink advances the Property fence', async () => {
    const f = current()
    const { row, summary } = await disconnectedProperty()
    const { input } = await f.selection()
    await f.binding.relink({
      organizationId: organizationId(f.orgId),
      propertyId: propertyId(row.id),
      idempotencyKey: randomUUID(),
      connectionId: googleConnectionId(f.connectionId),
      accountId: f.accountId,
      locationId: f.locationIds[0]!,
      profile: {
        name: row.name,
        address: null,
        timezone: 'UTC',
        confirmedBy: f.actor.userId,
      },
      expectedSourceEpoch: summary.sourceEpoch,
      expectedProfileVersion: summary.profileVersion,
      now: f.clock(),
    })
    await expect(f.commands().start(input, f.actor)).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(await f.propertyRows()).toHaveLength(1)
  })

  it('replays the same request, including reordered selection, and conflicts on different input', async () => {
    const f = current()
    const original = await start(2)
    await f.restart()
    expect(
      await f
        .commands()
        .start(
          { ...original.input, items: [...original.input.items].reverse() },
          f.actor,
        ),
    ).toEqual({
      importJobId: original.importJobId,
      replayed: true,
    })
    const fresh = await f.selection(1)
    await expect(
      f
        .commands()
        .start({ ...fresh.input, requestId: original.input.requestId }, f.actor),
    ).rejects.toMatchObject({ code: 'request_conflict' })
    expect(await f.commands().recover(original.input.requestId, f.actor)).toEqual({
      importJobId: original.importJobId,
    })
    await finish()
    expect(await f.propertyRows()).toHaveLength(2)
  })

  it('refuses another manager or tenant selection, recovery and progress', async () => {
    const f = current()
    const foreign = await f.selection(1, f.otherActor)
    await expect(f.commands().start(foreign.input, f.actor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    const own = await start()
    const otherTenant = { ...f.actor, organizationId: organizationId(randomUUID()) }
    await expect(f.commands().start(foreign.input, otherTenant)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    for (const actor of [f.otherActor, otherTenant]) {
      await expect(
        f.commands().recover(own.input.requestId, actor),
      ).rejects.toMatchObject({ code: 'invalid_reference' })
      await expect(f.commands().status(own.importJobId, actor)).rejects.toMatchObject({
        code: 'invalid_reference',
      })
      await expect(f.commands().cancel(own.importJobId, actor)).rejects.toMatchObject({
        code: 'invalid_reference',
      })
    }
    expect(await f.propertyRows()).toEqual([])
  })

  it('refuses expired discovery and returns only opaque references to the browser', async () => {
    const f = current()
    const { accounts, candidates, input } = await f.selection()
    const browserJson = JSON.stringify({ accounts, candidates })
    for (const providerId of [f.accountId, ...f.locationIds])
      expect(browserJson).not.toContain(providerId)
    f.advance(IMPORT_TEST_DAY_MS + 1)
    await expect(f.commands().start(input, f.actor)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    expect(await f.propertyRows()).toEqual([])
  })

  it('keeps partial success when another import binds one of the selected locations', async () => {
    const f = current()
    const selection = await f.selection(2)
    await start()
    await finish()
    const { importJobId } = await f.commands().start(selection.input, f.actor)
    await finish()
    expect(await f.commands().status(importJobId, f.actor)).toMatchObject({
      status: 'completed_with_issues',
      totalCount: 2,
      processedCount: 2,
      counts: { imported: 1, already_exists: 1 },
    })
    expect(await f.propertyRows()).toHaveLength(2)
  })
})
