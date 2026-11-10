// The shape each context's Property-scoped erasure takes when the rights
// executors run it: a read-only inventory of what the context holds for one
// Property, and the erase itself. Both are bound to one organization and one
// Property, so an erase leaves every sibling Property untouched.

import type { Tx } from '#/shared/outbox/commit'

export type PropertyEraseScope = Readonly<{
  organizationId: string
  propertyId: string
}>

/** One content-free line of an inventory: a table name and a row count. */
export type PropertyEraseInventoryEntry = Readonly<{
  context: string
  table: string
  rowCount: number
}>

export type PropertyEraseContributor = Readonly<{
  context: string
  /** Read only. */
  inventory(
    tx: Tx,
    scope: PropertyEraseScope,
  ): Promise<readonly PropertyEraseInventoryEntry[]>
  /** Irreversible. Removes this context's rows; returns how many went. */
  erase(tx: Tx, scope: PropertyEraseScope): Promise<number>
}>
