import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import type {
  GoogleImportLifecycleScope,
  GoogleImportStore,
} from '../application/ports/google-import-store.port'
import { assertLifecycleSweepLimit } from './import-store-helpers.server'

function lifecycleScopePredicate(scope: GoogleImportLifecycleScope) {
  const tenant = eq(googleImportItems.organizationId, scope.organizationId)
  switch (scope.kind) {
    case 'organization':
      return tenant
    case 'user':
      return and(tenant, eq(googleImports.initiatedBy, scope.userId))
    case 'connection':
      return and(tenant, eq(googleImportItems.connectionId, scope.connectionId))
    case 'property':
      return and(
        tenant,
        or(
          eq(googleImportItems.existingPropertyId, scope.propertyId),
          eq(googleImportItems.destinationPropertyId, scope.propertyId),
        ),
      )
    case 'request':
      return and(tenant, eq(googleImports.id, scope.importJobId))
  }
}

// Provider authority still held by an item: the lifecycle sweeps for a
// connection, user or organization visit these rows to cancel and scrub them.
// The destination Property is deliberately absent: a terminal `imported` row
// keeps it as a plain internal reference and holds no authority through it.
const lifecycleAuthorityPresent = or(
  sql`${googleImportItems.status} IN ('pending', 'processing')`,
  eq(googleImportItems.outcomeCode, 'temporarily_unavailable'),
  isNotNull(googleImportItems.connectionId),
  isNotNull(googleImportItems.existingPropertyId),
  isNotNull(googleImportItems.providerAccountSuffix),
  isNotNull(googleImportItems.providerLocationSuffix),
  isNotNull(googleImportItems.expectedConnectionLifecycleVersion),
  isNotNull(googleImportItems.expectedConnectionAccessVersion),
  isNotNull(googleImportItems.expectedCredentialGeneration),
  isNotNull(googleImportItems.expectedSourceEpoch),
  isNotNull(googleImportItems.expectedProfileVersion),
)

// A Property deletion must also find the terminal rows that still name the
// Property, so its sweep selects on the reference as well as on authority.
function lifecycleSweepPredicate(scope: GoogleImportLifecycleScope) {
  return scope.kind === 'property'
    ? and(
        lifecycleScopePredicate(scope),
        or(lifecycleAuthorityPresent, isNotNull(googleImportItems.destinationPropertyId)),
      )
    : and(lifecycleScopePredicate(scope), lifecycleAuthorityPresent)
}

export function createImportLifecycleStore(
  db: Database,
): Pick<
  GoogleImportStore,
  | 'listLifecycleScopeParents'
  | 'fenceLifecycleParent'
  | 'listLifecycleScopeItems'
  | 'scrubLifecycleItems'
  | 'countLifecycleScopeItems'
> {
  return {
    listLifecycleScopeParents: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .selectDistinct({
          organizationId: googleImports.organizationId,
          importJobId: googleImports.id,
        })
        .from(googleImports)
        .innerJoin(
          googleImportItems,
          and(
            eq(googleImportItems.organizationId, googleImports.organizationId),
            eq(googleImportItems.importId, googleImports.id),
          ),
        )
        .where(and(lifecycleScopePredicate(scope), eq(googleImports.deletionFence, 0)))
        .orderBy(asc(googleImports.id))
        .limit(limit)
    },

    fenceLifecycleParent: async (input) => {
      const [fenced] = await db
        .update(googleImports)
        .set({
          deletionFence: sql`${googleImports.deletionFence} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(googleImports.organizationId, input.organizationId),
            eq(googleImports.id, input.importJobId),
            eq(googleImports.deletionFence, 0),
          ),
        )
        .returning({ id: googleImports.id })
      return fenced ? ('fenced' as const) : ('lost' as const)
    },

    listLifecycleScopeItems: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({
          organizationId: googleImportItems.organizationId,
          importJobId: googleImportItems.importId,
          itemId: googleImportItems.id,
          retryRevision: googleImportItems.retryRevision,
          dispatchEpoch: googleImportItems.dispatchEpoch,
          status: googleImportItems.status,
          outcomeCode: googleImportItems.outcomeCode,
        })
        .from(googleImportItems)
        .innerJoin(
          googleImports,
          and(
            eq(googleImports.organizationId, googleImportItems.organizationId),
            eq(googleImports.id, googleImportItems.importId),
          ),
        )
        .where(lifecycleSweepPredicate(scope))
        .orderBy(asc(googleImportItems.createdAt), asc(googleImportItems.id))
        .limit(limit)
      return rows.map((row) => ({
        organizationId: row.organizationId,
        importJobId: row.importJobId,
        itemId: row.itemId,
        retryRevision: row.retryRevision,
        active:
          row.status === 'pending' ||
          row.status === 'processing' ||
          row.outcomeCode === 'temporarily_unavailable',
      }))
    },

    scrubLifecycleItems: async (input) => {
      const itemIds = [...new Set(input.itemIds)]
      if (itemIds.length < 1 || itemIds.length > 100) {
        throw new Error('google import lifecycle scrub requires 1 to 100 unique items')
      }
      const rows = await db
        .update(googleImportItems)
        .set({
          connectionId: null,
          existingPropertyId: null,
          destinationPropertyId: null,
          providerAccountSuffix: null,
          providerLocationSuffix: null,
          googleReviewUri: null,
          googlePrimaryCategory: null,
          expectedConnectionLifecycleVersion: null,
          expectedConnectionAccessVersion: null,
          expectedCredentialGeneration: null,
          expectedExecutionPolicyVersion: null,
          expectedActorRole: null,
          expectedPermissionDigest: null,
          expectedPrincipalKind: null,
          expectedPermissionVersion: null,
          expectedSourceEpoch: null,
          expectedProfileVersion: null,
          claimFence: null,
          claimLeaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(googleImportItems.organizationId, input.organizationId),
            inArray(googleImportItems.id, itemIds),
            sql`${googleImportItems.status} NOT IN ('pending', 'processing')`,
            sql`${googleImportItems.outcomeCode} <> 'temporarily_unavailable'`,
          ),
        )
        .returning({ id: googleImportItems.id })
      return rows.length
    },

    countLifecycleScopeItems: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({ itemId: googleImportItems.id })
        .from(googleImportItems)
        .innerJoin(
          googleImports,
          and(
            eq(googleImports.organizationId, googleImportItems.organizationId),
            eq(googleImports.id, googleImportItems.importId),
          ),
        )
        .where(lifecycleSweepPredicate(scope))
        .orderBy(asc(googleImportItems.createdAt), asc(googleImportItems.id))
        .limit(limit)
      return rows.length
    },
  }
}
