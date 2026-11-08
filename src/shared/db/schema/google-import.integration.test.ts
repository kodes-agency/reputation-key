import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { googleConnections } from './google-connection.schema'
import { googleImportItems, googleImports } from './google-import.schema'
import { properties } from './property.schema'

const NOW = new Date('2026-11-08T10:00:00.000Z')
const DAY = 86_400_000
const DEADLINE = new Date(NOW.getTime() + DAY)

type Item = typeof googleImportItems.$inferInsert

async function withImport(
  run: (fixture: {
    tx: Tx
    root: typeof googleImports.$inferInsert
    item: Item
  }) => Promise<void>,
) {
  const rollback = new Error('Roll back import fixture')
  try {
    await getDb().transaction(async (tx) => {
      const organizationId = `import-schema-${randomUUID()}`
      const connectionId = randomUUID()
      const root = {
        id: randomUUID(),
        organizationId,
        requestId: randomUUID(),
        initiatedBy: randomUUID(),
        totalCount: 1,
        wireReplayKeyVersion: 'v1',
        wireReplayDigest: 'A'.repeat(43),
        semanticReplayKeyVersion: 'v1',
        semanticReplayDigest: 'B'.repeat(43),
        createdAt: NOW,
        updatedAt: NOW,
      }
      await tx.insert(googleConnections).values({
        id: connectionId,
        organizationId,
        googleSubject: randomUUID(),
        encryptedAccessToken: 'synthetic-access',
        encryptedRefreshToken: 'synthetic-refresh',
        tokenExpiresAt: DEADLINE,
        scopes: ['https://www.googleapis.com/auth/business.manage'],
        connectedBy: root.initiatedBy,
      })
      await tx.insert(googleImports).values(root)
      const item: Item = {
        id: randomUUID(),
        organizationId,
        importId: root.id,
        connectionId,
        destinationPropertyId: randomUUID(),
        providerAccountSuffix: 'account',
        providerLocationSuffix: 'location',
        googleReviewUri: 'https://search.google.com/local/writereview?placeid=synthetic',
        googlePrimaryCategory: 'Cafe',
        expectedConnectionLifecycleVersion: 1,
        expectedConnectionAccessVersion: 1,
        expectedCredentialGeneration: 1,
        expectedExecutionPolicyVersion: 'beta-local-2',
        expectedActorRole: 'Admin',
        expectedPermissionDigest: 'a'.repeat(64),
        expectedPrincipalKind: 'user',
        expectedPermissionVersion: 1,
        action: 'create',
        updateExistingProfile: true,
        propertyName: 'Import cafe',
        countryCode: 'US',
        timezone: 'UTC',
        effectDeadlineAt: DEADLINE,
        nextDispatchAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }
      await run({ tx, root, item })
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
}

async function rejectedItem(tx: Tx, item: Item, code = '23514') {
  await expect(
    tx.transaction((savepoint) => savepoint.insert(googleImportItems).values(item)),
  ).rejects.toMatchObject({ cause: { code } })
}

describe('single-root Google import checkpoints (PostgreSQL)', () => {
  it('accepts more than 100 items without child batches', () =>
    withImport(async ({ tx, root, item }) => {
      await tx
        .update(googleImports)
        .set({ totalCount: 101 })
        .where(eq(googleImports.id, root.id))
      await tx
        .insert(googleImportItems)
        .values(Array.from({ length: 101 }, () => ({ ...item, id: randomUUID() })))
      expect(
        await tx
          .select()
          .from(googleImportItems)
          .where(eq(googleImportItems.importId, root.id)),
      ).toHaveLength(101)
    }))

  it('keeps a request identity unique within its organization', () =>
    withImport(async ({ tx, root }) => {
      await expect(
        tx.transaction((savepoint) =>
          savepoint.insert(googleImports).values({ ...root, id: randomUUID() }),
        ),
      ).rejects.toMatchObject({ cause: { code: '23505' } })
      await tx
        .insert(googleImports)
        .values({ ...root, id: randomUUID(), organizationId: randomUUID() })
    }))

  it('refuses a parent from another organization', () =>
    withImport(async ({ tx, root, item }) => {
      const foreignId = randomUUID()
      await tx
        .insert(googleImports)
        .values({ ...root, id: foreignId, organizationId: randomUUID() })
      await rejectedItem(tx, { ...item, importId: foreignId }, '23503')
    }))

  it('refuses a connection from another organization', () =>
    withImport(async ({ tx, root, item }) => {
      const connectionId = randomUUID()
      await tx.insert(googleConnections).values({
        id: connectionId,
        organizationId: randomUUID(),
        googleSubject: randomUUID(),
        encryptedAccessToken: 'synthetic-access',
        encryptedRefreshToken: 'synthetic-refresh',
        tokenExpiresAt: DEADLINE,
        scopes: ['https://www.googleapis.com/auth/business.manage'],
        connectedBy: root.initiatedBy,
      })
      await rejectedItem(tx, { ...item, connectionId }, '23503')
    }))

  it('allows a same-organization relink and refuses a foreign Property', () =>
    withImport(async ({ tx, root, item }) => {
      for (const organizationId of [root.organizationId, randomUUID()]) {
        const propertyId = randomUUID()
        await tx.insert(properties).values({
          id: propertyId,
          organizationId,
          name: 'Cafe',
          slug: randomUUID(),
          timezone: 'UTC',
        })
        const relink: Item = {
          ...item,
          id: randomUUID(),
          action: 'relink',
          existingPropertyId: propertyId,
          destinationPropertyId: propertyId,
          expectedSourceEpoch: 0,
          expectedProfileVersion: 1,
        }
        if (organizationId === root.organizationId)
          await tx.insert(googleImportItems).values(relink)
        else await rejectedItem(tx, relink, '23503')
      }
    }))

  it.each([
    { dispatchEpoch: -1 },
    { retryRevision: -1 },
    { highestAttemptForRevision: 6 },
    { nextDispatchAt: null },
    { expectedPrincipalKind: null },
    { expectedPermissionVersion: null },
    { expectedCredentialGeneration: null },
    { effectDeadlineAt: new Date(DEADLINE.getTime() + 1) },
    { claimFence: randomUUID(), claimLeaseExpiresAt: DEADLINE },
    { status: 'processing', highestAttemptForRevision: 1 },
    { status: 'failed', outcomeCode: null },
  ] satisfies Partial<Item>[])(
    'rejects an incomplete or invalid active checkpoint: %j',
    (patch) =>
      withImport(async ({ tx, item }) => rejectedItem(tx, { ...item, ...patch })),
  )

  it('accepts a leased fifth attempt with its next durable recovery appointment', () =>
    withImport(async ({ tx, item }) => {
      await tx.insert(googleImportItems).values({
        ...item,
        status: 'processing',
        highestAttemptForRevision: 5,
        dispatchEpoch: 4,
        claimFence: randomUUID(),
        claimLeaseExpiresAt: new Date(NOW.getTime() + 60_000),
        nextDispatchAt: new Date(NOW.getTime() + 60_000),
      })
    }))

  it('keeps the protected state of a retryable failure and stops automatic dispatch', () =>
    withImport(async ({ tx, item }) => {
      const retryable: Item = {
        ...item,
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        firstTerminalAt: NOW,
        nextDispatchAt: null,
      }
      await rejectedItem(tx, { ...retryable, connectionId: null })
      await rejectedItem(tx, { ...retryable, nextDispatchAt: NOW })
      await tx.insert(googleImportItems).values(retryable)
    }))

  it('requires provider state to be scrubbed for a non-retryable terminal item', () =>
    withImport(async ({ tx, item }) => {
      await rejectedItem(tx, {
        ...item,
        status: 'cancelled',
        outcomeCode: 'user_cancelled',
        firstTerminalAt: NOW,
        nextDispatchAt: null,
      })
      const terminal: Item = {
        id: item.id,
        organizationId: item.organizationId,
        importId: item.importId,
        action: 'create',
        updateExistingProfile: true,
        propertyName: item.propertyName,
        timezone: item.timezone,
        status: 'cancelled',
        outcomeCode: 'user_cancelled',
        firstTerminalAt: NOW,
        effectDeadlineAt: DEADLINE,
        createdAt: NOW,
      }
      await tx.insert(googleImportItems).values(terminal)
    }))

  it('stores one thirty-day retention window and cascades the whole import', () =>
    withImport(async ({ tx, root, item }) => {
      await tx.insert(googleImportItems).values(item)
      await expect(
        tx.transaction((savepoint) =>
          savepoint
            .update(googleImports)
            .set({
              firstTerminalAt: NOW,
              purgeAt: new Date(NOW.getTime() + 30 * DAY + 1),
            })
            .where(eq(googleImports.id, root.id)),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } })
      await tx
        .update(googleImports)
        .set({ firstTerminalAt: NOW, purgeAt: new Date(NOW.getTime() + 30 * DAY) })
        .where(eq(googleImports.id, root.id))
      await tx
        .delete(googleImports)
        .where(
          and(
            eq(googleImports.organizationId, root.organizationId),
            eq(googleImports.id, root.id),
          ),
        )
      expect(
        await tx
          .select()
          .from(googleImportItems)
          .where(eq(googleImportItems.importId, root.id)),
      ).toEqual([])
      expect(
        await tx
          .select()
          .from(googleConnections)
          .where(eq(googleConnections.id, item.connectionId!)),
      ).toHaveLength(1)
    }))
})
