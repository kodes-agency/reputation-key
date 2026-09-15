// Inbox property scope — the rules behind the queue rail's property section and
// the compact header's scope menu, kept pure so both render from one decision.
//
// Properties are the Inbox's second axis. Queues say what the work is; the
// property list says whose it is, with each property's count for the queue in
// view. "All properties" is the organization-wide Inbox (`/inbox`), offered only
// to roles that have one; a property is its own Reviews page.

import type { InboxPropertyCounts } from '#/contexts/inbox/application/public-api'

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

/** The scope as rendered: properties sorted by name, with the counts for the
 * queue in view (undefined until they load). */
export type InboxPropertyScope = InboxPropertyScopeInput &
  Readonly<{ counts: InboxPropertyCounts | undefined }>

/** Rows shown before "Show all". */
const PROPERTY_PREVIEW_LIMIT = 7

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** By name, never by count: a list that reorders while you work moves the row
 * under your cursor. */
export function sortScopeProperties(
  properties: ReadonlyArray<InboxScopeProperty>,
): ReadonlyArray<InboxScopeProperty> {
  return [...properties].sort((a, b) => byName.compare(a.name, b.name))
}

/** One property is not a choice, so it gets no section and no menu. */
export function offersPropertyScope(properties: ReadonlyArray<unknown>): boolean {
  return properties.length > 1
}

/**
 * The first seven by name, plus the property in view wherever it sorts. The
 * list folds only when that hides at least two rows: a "Show all" in place of
 * one row would cost exactly the space it saves.
 */
export function previewScopeProperties(
  properties: ReadonlyArray<InboxScopeProperty>,
  activePropertyId: string | null,
  expanded: boolean,
): Readonly<{ visible: ReadonlyArray<InboxScopeProperty>; isFolded: boolean }> {
  if (expanded || properties.length <= PROPERTY_PREVIEW_LIMIT + 1) {
    return { visible: properties, isFolded: false }
  }
  const visible = properties.filter(
    (property, index) =>
      index < PROPERTY_PREVIEW_LIMIT || property.id === activePropertyId,
  )
  return { visible, isFolded: true }
}

/** A scope row's count: the organization total for "All properties" (null). */
export function scopeCount(
  counts: InboxPropertyCounts | undefined,
  propertyId: string | null,
): number | undefined {
  if (!counts) return undefined
  return propertyId === null ? counts.total : (counts.byProperty[propertyId] ?? 0)
}

/**
 * Search carried across a scope change: the queue, filters and sort stay; an
 * item opened under the old scope, and the old scope itself, do not.
 */
export function searchAfterInboxScopeChange(search: unknown): Record<string, unknown> {
  if (search === null || typeof search !== 'object') return {}

  return Object.fromEntries(
    Object.entries(search).filter(([key]) => key !== 'itemId' && key !== 'propertyId'),
  )
}
