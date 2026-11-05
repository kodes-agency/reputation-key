import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import type { Property } from '../domain/types'
import { propertyToRow } from './mappers/property.mapper'

/** Seeds a Property without running a product command or recording a fact. */
export async function seedTestProperty(db: Database, property: Property): Promise<void> {
  await db.insert(properties).values(propertyToRow(property))
}
