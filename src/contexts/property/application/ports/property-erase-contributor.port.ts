// LIF-01-T19 — the port every context implements to take part in a permanent
// Property Erase.
//
// Two operations, and the split is the whole design:
//
//   inventory() is READ ONLY and runs BEFORE confirmation. It is what the
//   AccountAdmin is shown, so it must be content-free — a table name and a row
//   count, never a review body, a guest rating or a staff member's name.
//
//   erase() is IRREVERSIBLE and runs after confirmation, asynchronously, one
//   Property at a time, resuming from persisted receipts.
//
// A contributor that answers `no_data` still answers. An omitted contributor
// would make a partial erasure look complete, which is the same failure the
// Organization lifecycle receipt set exists to prevent.

import type { Tx } from '#/shared/outbox/commit'

/**
 * The contexts that can own rows for a single Property.
 *
 * Every bounded context is registered. `identity` was absent until it was
 * checked against `data-fate-authority.ts`, which names it the OWNER of seven
 * Property-scoped tables — so its omission asserted, falsely, that Identity
 * holds no rows for a Property. Four of those seven are erased by
 * `identity-property-erase.adapter.ts`; the other three are
 * `recoverable_archive` and are excluded there, by disposition and with the
 * reason recorded at the exclusion.
 */
export const PROPERTY_ERASE_CONTEXTS = [
  'activity',
  'ai',
  'badge',
  'dashboard',
  'goal',
  'guest',
  'identity',
  'inbox',
  'integration',
  'leaderboard',
  'metric',
  'notification',
  'portal',
  'property',
  'review',
  'staff',
  'team',
] as const

export type PropertyEraseContext = (typeof PROPERTY_ERASE_CONTEXTS)[number]

export type PropertyEraseScope = Readonly<{
  organizationId: string
  propertyId: string
}>

/**
 * One content-free line of the dependency inventory.
 *
 * `table` is a schema identifier and `rowCount` is a number. Nothing here can
 * carry tenant content, which is what makes the preview safe to show and safe
 * to digest into the confirmation binding.
 */
export type PropertyEraseInventoryEntry = Readonly<{
  context: PropertyEraseContext
  table: string
  rowCount: number
}>

export type PropertyEraseContributor = Readonly<{
  context: PropertyEraseContext
  /** READ ONLY. Row counts this context owns for the Property. */
  inventory(
    tx: Tx,
    scope: PropertyEraseScope,
  ): Promise<readonly PropertyEraseInventoryEntry[]>
  /** IRREVERSIBLE. Removes this context's rows; returns how many went. */
  erase(tx: Tx, scope: PropertyEraseScope): Promise<number>
}>
