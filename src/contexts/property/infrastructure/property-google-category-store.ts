import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { lockGoogleConnectionBindingAuthority } from '#/shared/db/google-connection-binding-authority'
import { normalizeGooglePrimaryCategory } from '#/shared/domain/google-primary-category'
import type { PropertyGoogleBindingStore } from '../application/ports/property-google-binding.port'

export const createGooglePrimaryCategoryRefresh =
  (db: Database): PropertyGoogleBindingStore['refreshPrimaryCategory'] =>
  async (input) => {
    const category = normalizeGooglePrimaryCategory(input.category)
    if (category === null) return false
    return db.transaction(async (tx) => {
      if (
        !(await lockGoogleConnectionBindingAuthority(tx, {
          ...input,
          expectedLifecycleVersion: input.expectedConnectionLifecycleVersion,
          expectedAccessVersion: input.expectedConnectionAccessVersion,
        }))
      )
        return false
      const rows = await tx
        .update(properties)
        .set({
          googlePrimaryCategory: category,
          googlePrimaryCategoryUpdatedAt: input.readAt,
        })
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            eq(properties.id, input.propertyId),
            eq(properties.googleConnectionId, input.connectionId),
            eq(properties.gbpAccountId, input.accountId),
            eq(properties.gbpLocationId, input.locationId),
            eq(properties.googleBindingState, 'active'),
            eq(properties.sourceEpoch, input.expectedSourceEpoch),
            eq(properties.profileVersion, input.expectedProfileVersion),
            eq(properties.googlePrimaryCategoryRefreshEventId, input.refreshEventId),
            isNull(properties.deletedAt),
          ),
        )
        .returning({ id: properties.id })
      return rows.length === 1
    })
  }
