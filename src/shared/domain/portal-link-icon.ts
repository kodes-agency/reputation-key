// The closed set of icons a Portal link tile may carry.
//
// A tile stores a key, never a file or a name the guest page has to trust: the
// guest renderer maps each key to a lucide icon and draws nothing for a key it
// does not know. The database enforces the same set with a CHECK on
// `portal_links.icon_key` (migration 0044), and managers' inputs are refused
// outside it. Widening the set is a new migration plus a renderer entry.
//
// Pure on purpose (no zod, no I/O) so domain code may import it; the zod schema
// and the SQL rendering live in `src/shared/portal-link-icon-schemas.ts`.

export const PORTAL_LINK_ICON_KEYS = Object.freeze([
  'link',
  'external-link',
  'globe',
  'utensils',
  'coffee',
  'wine',
  'bed-double',
  'map-pin',
  'phone',
  'mail',
  'calendar',
  'clock',
  'star',
  'gift',
  'shopping-bag',
  'music',
  'ticket',
  'wifi',
  'car',
  'info',
  'heart',
  'scissors',
  'sparkles',
  'camera',
  'book-open',
] as const)

export type PortalLinkIconKey = (typeof PORTAL_LINK_ICON_KEYS)[number]

const ICON_KEY_SET: ReadonlySet<string> = new Set(PORTAL_LINK_ICON_KEYS)

export function isPortalLinkIconKey(value: unknown): value is PortalLinkIconKey {
  return typeof value === 'string' && ICON_KEY_SET.has(value)
}

/** A member of the set, or null: an unknown key is dropped, never coerced. */
export function parsePortalLinkIconKey(value: unknown): PortalLinkIconKey | null {
  return isPortalLinkIconKey(value) ? value : null
}
