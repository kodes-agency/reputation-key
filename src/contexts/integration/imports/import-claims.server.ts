import { and, eq, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import type {
  GoogleImportClaimedItem,
  GoogleImportStore,
} from '../application/ports/google-import-store.port'
import { importItemAdmitsAttempt } from '../application/google-import-item-attempt'
import {
  authorizationFromRow,
  itemScope as googleImportItemScope,
  lockItemParent,
  touchParent,
  unclaimedTerminalAuthority,
} from './import-store-helpers.server'

export const AUTHORIZATION_SNAPSHOT_COLUMNS = {
  expectedConnectionLifecycleVersion:
    googleImportItems.expectedConnectionLifecycleVersion,
  expectedConnectionAccessVersion: googleImportItems.expectedConnectionAccessVersion,
  expectedCredentialGeneration: googleImportItems.expectedCredentialGeneration,
  expectedExecutionPolicyVersion: googleImportItems.expectedExecutionPolicyVersion,
  expectedActorRole: googleImportItems.expectedActorRole,
  expectedPermissionDigest: googleImportItems.expectedPermissionDigest,
  expectedPrincipalKind: googleImportItems.expectedPrincipalKind,
  expectedPermissionVersion: googleImportItems.expectedPermissionVersion,
  expectedSourceEpoch: googleImportItems.expectedSourceEpoch,
  expectedProfileVersion: googleImportItems.expectedProfileVersion,
} as const

export function createImportClaims(
  db: Database,
): Pick<GoogleImportStore, 'claimItem' | 'runClaimedEffect' | 'releaseClaimForRetry'> {
  return {
    claimItem: async (input) =>
      db.transaction(async (tx) => {
        const parent = await lockItemParent(tx, input.organizationId, input.itemId)
        if (!parent) return { kind: 'ignored', reason: 'missing' } as const
        const [row] = await tx
          .select({
            organizationId: googleImportItems.organizationId,
            importJobId: googleImportItems.importId,
            itemId: googleImportItems.id,
            initiatedBy: googleImports.initiatedBy,
            connectionId: googleImportItems.connectionId,
            existingPropertyId: googleImportItems.existingPropertyId,
            destinationPropertyId: googleImportItems.destinationPropertyId,
            providerAccountSuffix: googleImportItems.providerAccountSuffix,
            providerLocationSuffix: googleImportItems.providerLocationSuffix,
            googleReviewUri: googleImportItems.googleReviewUri,
            googlePrimaryCategory: googleImportItems.googlePrimaryCategory,
            ...AUTHORIZATION_SNAPSHOT_COLUMNS,
            action: googleImportItems.action,
            updateExistingProfile: googleImportItems.updateExistingProfile,
            propertyName: googleImportItems.propertyName,
            propertyAddress: googleImportItems.propertyAddress,
            countryCode: googleImportItems.countryCode,
            timezone: googleImportItems.timezone,
            status: googleImportItems.status,
            retryRevision: googleImportItems.retryRevision,
            dispatchEpoch: googleImportItems.dispatchEpoch,
            highestAttemptForRevision: googleImportItems.highestAttemptForRevision,
            claimFence: googleImportItems.claimFence,
            claimLeaseExpiresAt: googleImportItems.claimLeaseExpiresAt,
            effectDeadlineAt: googleImportItems.effectDeadlineAt,
            parentPurgeAt: googleImports.purgeAt,
          })
          .from(googleImportItems)
          .innerJoin(
            googleImports,
            and(
              eq(googleImports.organizationId, googleImportItems.organizationId),
              eq(googleImports.id, googleImportItems.importId),
            ),
          )
          .where(googleImportItemScope(input.organizationId, input.itemId))
          .for('update', { of: googleImportItems })
          .limit(1)
        if (!row) return { kind: 'ignored', reason: 'missing' } as const
        if (row.status !== 'pending' && row.status !== 'processing') {
          return { kind: 'ignored', reason: 'terminal' } as const
        }
        if (row.retryRevision !== input.retryRevision) {
          return { kind: 'ignored', reason: 'stale_revision' } as const
        }
        if (row.dispatchEpoch !== input.dispatchEpoch) {
          return { kind: 'ignored', reason: 'stale_dispatch' } as const
        }
        const expiredClaim =
          row.status === 'processing' &&
          row.claimLeaseExpiresAt !== null &&
          row.claimLeaseExpiresAt <= input.now
        if (row.status === 'processing' && !expiredClaim) {
          return { kind: 'ignored', reason: 'claim_active' } as const
        }
        if (
          input.now >= row.effectDeadlineAt ||
          (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt)
        ) {
          return {
            kind: 'ignored',
            reason: 'effect_expired',
            effectDeadlineAt: row.effectDeadlineAt,
            authority: unclaimedTerminalAuthority(row, expiredClaim),
          } as const
        }
        if (
          !importItemAdmitsAttempt(
            row.highestAttemptForRevision,
            row.highestAttemptForRevision + 1,
          )
        ) {
          return {
            kind: 'ignored',
            reason: 'attempts_exhausted',
            effectDeadlineAt: row.effectDeadlineAt,
            authority: unclaimedTerminalAuthority(row, expiredClaim),
          } as const
        }
        const attemptOrdinal = row.highestAttemptForRevision + 1
        const dispatchEpoch = row.dispatchEpoch + (expiredClaim ? 1 : 0)
        const authorization = authorizationFromRow(row)
        if (
          !authorization ||
          row.destinationPropertyId === null ||
          row.providerAccountSuffix === null ||
          row.providerLocationSuffix === null ||
          row.connectionId === null
        ) {
          throw new Error('google import item authorization snapshot is incomplete')
        }
        const [claimed] = await tx
          .update(googleImportItems)
          .set({
            status: 'processing',
            highestAttemptForRevision: attemptOrdinal,
            dispatchEpoch,
            nextDispatchAt: input.leaseExpiresAt,
            claimFence: input.claimFence,
            claimLeaseExpiresAt: input.leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(googleImportItems.organizationId, input.organizationId),
              eq(googleImportItems.id, input.itemId),
              eq(googleImportItems.retryRevision, input.retryRevision),
            ),
          )
          .returning({ id: googleImportItems.id })
        if (!claimed) return { kind: 'ignored', reason: 'claim_active' } as const
        await touchParent(tx, input.organizationId, row.importJobId, input.now)
        return {
          kind: 'claimed',
          item: {
            ...row,
            connectionId: row.connectionId,
            expectedConnectionLifecycleVersion: authorization.connectionLifecycleVersion,
            expectedConnectionAccessVersion: authorization.connectionAccessVersion,
            expectedCredentialGeneration: authorization.credentialGeneration,
            destinationPropertyId: row.destinationPropertyId,
            providerAccountSuffix: row.providerAccountSuffix,
            providerLocationSuffix: row.providerLocationSuffix,
            googleReviewUri: row.googleReviewUri,
            authorization,
            attemptOrdinal,
            dispatchEpoch,
            claimFence: input.claimFence,
          } satisfies GoogleImportClaimedItem,
        } as const
      }),

    runClaimedEffect: async (input, effect) =>
      db.transaction(async (tx) => {
        // Only the item row is held across the effect, never the import root:
        // sibling items and organization closure take the root first and must
        // not queue behind a provider call. A closure still waits for the
        // effect through the connection lock the effect takes inside.
        const [row] = await tx
          .select({
            status: googleImportItems.status,
            retryRevision: googleImportItems.retryRevision,
            dispatchEpoch: googleImportItems.dispatchEpoch,
            highestAttemptForRevision: googleImportItems.highestAttemptForRevision,
            claimFence: googleImportItems.claimFence,
            claimLeaseExpiresAt: googleImportItems.claimLeaseExpiresAt,
            effectDeadlineAt: googleImportItems.effectDeadlineAt,
            parentPurgeAt: googleImports.purgeAt,
          })
          .from(googleImportItems)
          .innerJoin(
            googleImports,
            and(
              eq(googleImports.organizationId, googleImportItems.organizationId),
              eq(googleImports.id, googleImportItems.importId),
            ),
          )
          .where(googleImportItemScope(input.organizationId, input.itemId))
          .for('update', { of: googleImportItems })
          .limit(1)
        if (
          !row ||
          row.status !== 'processing' ||
          row.retryRevision !== input.retryRevision ||
          row.dispatchEpoch !== input.dispatchEpoch ||
          row.highestAttemptForRevision !== input.attemptOrdinal ||
          row.claimFence !== input.claimFence ||
          row.claimLeaseExpiresAt === null ||
          row.claimLeaseExpiresAt <= input.now
        ) {
          return { kind: 'lost' } as const
        }
        if (
          input.now >= row.effectDeadlineAt ||
          (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt)
        ) {
          return { kind: 'effect_expired' } as const
        }
        return { kind: 'executed', value: await effect() } as const
      }),

    releaseClaimForRetry: async (input) =>
      db.transaction(async (tx) => {
        const parent = await lockItemParent(tx, input.organizationId, input.itemId)
        if (!parent) return 'lost' as const
        const [released] = await tx
          .update(googleImportItems)
          .set({
            status: 'pending',
            dispatchEpoch: sql`${googleImportItems.dispatchEpoch} + 1`,
            nextDispatchAt: new Date(input.now.getTime() + 60_000),
            claimFence: null,
            claimLeaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(googleImportItems.organizationId, input.organizationId),
              eq(googleImportItems.id, input.itemId),
              eq(googleImportItems.retryRevision, input.retryRevision),
              eq(googleImportItems.dispatchEpoch, input.dispatchEpoch),
              ...(input.expiredOnly
                ? [lte(googleImportItems.claimLeaseExpiresAt, input.now)]
                : []),
              eq(googleImportItems.claimFence, input.claimFence),
              eq(googleImportItems.status, 'processing'),
            ),
          )
          .returning({ importJobId: googleImportItems.importId })
        if (!released) return 'lost' as const
        await touchParent(tx, input.organizationId, released.importJobId, input.now)
        return 'released' as const
      }),
  }
}
