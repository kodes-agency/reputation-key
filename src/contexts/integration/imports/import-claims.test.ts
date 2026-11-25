import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { googleImportItems } from '#/shared/db/schema/google-import.schema'
import { createImportClaims } from './import-claims.server'

const NOW = new Date('2026-08-12T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1_000
const ORG_ID = 'import-claims-org'
const IMPORT_ID = '30000000-0000-4000-8000-000000000001'
const ITEM_ID = '30000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '30000000-0000-4000-8000-000000000003'
const PROPERTY_ID = '30000000-0000-4000-8000-000000000004'

// A pending item as the claim reads it: every column the claim selects.
const claimableRow = {
  organizationId: ORG_ID,
  importJobId: IMPORT_ID,
  itemId: ITEM_ID,
  initiatedBy: 'import-claims-user',
  connectionId: CONNECTION_ID,
  existingPropertyId: null,
  destinationPropertyId: PROPERTY_ID,
  providerAccountSuffix: 'account-1',
  providerLocationSuffix: 'location-1',
  googleReviewUri: null,
  googlePrimaryCategory: null,
  expectedConnectionLifecycleVersion: 1,
  expectedConnectionAccessVersion: 1,
  expectedCredentialGeneration: 1,
  expectedExecutionPolicyVersion: 'beta-local-2',
  expectedActorRole: 'Admin',
  expectedPermissionDigest: 'a'.repeat(64),
  expectedPrincipalKind: 'user',
  expectedPermissionVersion: 1,
  expectedSourceEpoch: null,
  expectedProfileVersion: null,
  action: 'create',
  updateExistingProfile: true,
  propertyName: 'Cafe One',
  propertyAddress: null,
  countryCode: 'US',
  timezone: 'America/New_York',
  status: 'pending',
  retryRevision: 0,
  dispatchEpoch: 0,
  highestAttemptForRevision: 0,
  claimFence: null,
  claimLeaseExpiresAt: null,
  effectDeadlineAt: new Date(NOW.getTime() + DAY_MS),
  parentPurgeAt: null,
}

const claimInput = {
  organizationId: ORG_ID,
  itemId: ITEM_ID,
  retryRevision: 0,
  dispatchEpoch: 0,
  attemptOrdinal: 1,
  claimFence: 'fence-1',
  now: NOW,
  leaseExpiresAt: new Date(NOW.getTime() + 30_000),
}

/**
 * A transaction that answers the claim's three reads in order (the item's
 * import, the locked import, the item row) and records what the claim writes to
 * the item. The CHECK constraints keep an incomplete snapshot off a pending
 * item in a real database, so the fail-closed guard can only be reached here.
 */
function databaseWithItem(row: Readonly<Record<string, unknown>>) {
  const itemWrites: Array<Record<string, unknown>> = []
  const reads: unknown[][] = [[{ importId: IMPORT_ID }], [{ id: IMPORT_ID }], [row]]
  const read = {
    from: () => read,
    innerJoin: () => read,
    where: () => read,
    for: () => read,
    limit: async () => reads.shift() ?? [],
  }
  const tx = {
    select: () => read,
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () =>
          Object.assign(Promise.resolve(), {
            returning: async () => {
              if (table === googleImportItems) itemWrites.push(values)
              return [{ id: ITEM_ID, importJobId: IMPORT_ID }]
            },
          }),
      }),
    }),
  }
  const db = {
    transaction: async (run: (executor: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Database
  return { db, itemWrites }
}

describe('claimItem authorization snapshot', () => {
  it('claims a pending item whose snapshot is complete', async () => {
    const { db, itemWrites } = databaseWithItem(claimableRow)

    const result = await createImportClaims(db).claimItem(claimInput)

    expect(result).toMatchObject({ kind: 'claimed', item: { claimFence: 'fence-1' } })
    expect(itemWrites).toMatchObject([{ status: 'processing', claimFence: 'fence-1' }])
  })

  it.each([
    ['connection', { connectionId: null }],
    ['destination Property', { destinationPropertyId: null }],
    ['provider account', { providerAccountSuffix: null }],
    ['provider location', { providerLocationSuffix: null }],
    ['connection lifecycle version', { expectedConnectionLifecycleVersion: null }],
    ['actor role', { expectedActorRole: null }],
  ])(
    'refuses to claim an item that has no %s on record, and writes nothing',
    async (_missing, gap) => {
      const { db, itemWrites } = databaseWithItem({ ...claimableRow, ...gap })

      await expect(createImportClaims(db).claimItem(claimInput)).rejects.toThrow(
        'authorization snapshot is incomplete',
      )
      expect(itemWrites).toEqual([])
    },
  )
})
