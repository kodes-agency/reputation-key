// Commits a Property profile update and its outbox fact in one transaction: a
// crash rolls back both, so the fact exists exactly when the update committed.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { propertyError } from '../domain/errors'
import type { Property } from '../domain/types'
import { propertyFromRow } from './mappers/property.mapper'
import type {
  PropertyCommandStore,
  UpdatePropertyCommand,
} from '../application/ports/property-command-store.port'

type PropertySetValues = {
  name?: string
  slug?: string
  timezone?: string
  defaultReplyLanguage?: string | null
  address?: string | null
  gbpLocationId?: string | null
  gbpAccountId?: string | null
  googleConnectionId?: string | null
  profileVersion?: number
  googleBindingState?:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  profileSource?: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt?: Date | null
  profileConfirmedBy?: string | null
  updatedAt?: Date
  deletedAt?: Date | null
  // Property locale facts
  countryCode?: string | null
  countrySource?: string | null
  timezoneSource?: string | null
  timezoneResolvedAt?: Date | null
  sourceEpoch?: number
}

/** The columns a property patch may set — never identity columns. */
const SETTABLE_PROPERTY_KEYS = [
  'updatedAt',
  'name',
  'slug',
  'timezone',
  'defaultReplyLanguage',
  'address',
  'gbpLocationId',
  'gbpAccountId',
  'googleConnectionId',
  'profileVersion',
  'googleBindingState',
  'profileSource',
  'profileConfirmedAt',
  'profileConfirmedBy',
  'countryCode',
  'countrySource',
  'timezoneSource',
  'timezoneResolvedAt',
  'sourceEpoch',
] as const satisfies ReadonlyArray<keyof PropertySetValues & keyof Property>

/** Never sets identity columns. */
function buildPropertySetClause(patch: Readonly<Partial<Property>>): PropertySetValues {
  const set: Record<string, unknown> = {}
  for (const key of SETTABLE_PROPERTY_KEYS) {
    if (patch[key] !== undefined) set[key] = patch[key]
  }
  return set as PropertySetValues
}

export const createAtomicPropertyCommandStore = (db: Database): PropertyCommandStore => {
  return {
    updateProperty: async (command: UpdatePropertyCommand) => {
      return trace('property.commandStore.updateProperty', async () => {
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(properties)
            .set(buildPropertySetClause(command.patch))
            .where(
              and(
                eq(properties.organizationId, command.organizationId as string),
                eq(properties.id, command.propertyId as string),
                isNull(properties.deletedAt),
                eq(properties.sourceEpoch, command.expectedSourceEpoch),
                eq(properties.profileVersion, command.expectedProfileVersion),
              ),
            )
            .returning()
          if (!row) {
            throw propertyError(
              'stale_property',
              'property changed while the update was being committed',
            )
          }
          // The fact names the row this statement left, not the caller's read.
          const committed = propertyFromRow(row)
          await insertOutboxRow(tx, command.event(committed))
          return committed
        })
        return updated
      })
    },
  }
}
