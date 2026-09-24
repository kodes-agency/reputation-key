// Inbox property scope — the rules behind the property select, which sits above
// the queues in the rail and on the list header's scope line below the desktop
// floor. Kept pure so both placements render from one decision.
//
// Properties are the Inbox's second axis. Queues say what the work is; the
// property list says whose it is, with each property's count for the queue in
// view. "All properties" is the organization-wide Inbox (`/inbox`), offered only
// to roles that have one; a property is its own Reviews page.

import type { InboxPropertyCounts } from '#/contexts/inbox/application/public-api'
import {
  matchesPropertySearch,
  offersPropertySearch,
  sortPropertiesByName,
} from '#/components/property/property-search'

export type InboxScopeProperty = Readonly<{ id: string; name: string }>

/** What a route knows about scope: the choices and where the viewer stands. */
export type InboxPropertyScopeInput = Readonly<{
  properties: ReadonlyArray<InboxScopeProperty>
  /** Null on the organization-wide Inbox. */
  activePropertyId: string | null
  /** Roles with an organization-wide Inbox get "All properties". */
  includeAll: boolean
  onSelect: (propertyId: string | null) => void
}>

/** The scope as rendered: the same choices, with the properties sorted by name. */
export type InboxPropertyScope = InboxPropertyScopeInput

/** By name, never by count: a list that reorders while you work moves the row
 * under your cursor. */
export function sortScopeProperties(
  properties: ReadonlyArray<InboxScopeProperty>,
): ReadonlyArray<InboxScopeProperty> {
  return sortPropertiesByName(properties)
}

/** One property is not a choice, so it gets no section and no menu. */
export function offersPropertyScope(properties: ReadonlyArray<unknown>): boolean {
  return properties.length > 1
}

/** Typing into a list you can read at a glance is noise, so short lists have
 * no search field. */
export function offersScopeSearch(properties: ReadonlyArray<unknown>): boolean {
  return offersPropertySearch(properties.length)
}

/**
 * Whether a property name answers a search, by the one rule every property
 * picker in the product uses (`#/components/property/property-search`).
 */
export function matchesScopeSearch(name: string, search: string): boolean {
  return matchesPropertySearch(name, search)
}

/** A scope row's count: the organization total for "All properties" (null). */
export function scopeCount(
  counts: InboxPropertyCounts | undefined,
  propertyId: string | null,
): number | undefined {
  if (!counts) return undefined
  return propertyId === null ? counts.total : (counts.byProperty[propertyId] ?? 0)
}
