import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { LINK_ICONS } from '#/components/features/portal/link-tree/link-icons'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'

/** The mark on every tile that opens something outside the page. */
export const LinktreeArrow = ArrowUpRight

/**
 * The icon of a tile. A tile with no key shows the default link icon. A key the
 * map does not know (a snapshot written by a later release) draws nothing, never
 * another icon in its place.
 */
export function linktreeIconFor(key: string | null): LucideIcon | null {
  if (key === null) return LINK_ICONS.link
  return Object.hasOwn(LINK_ICONS, key) ? LINK_ICONS[key as PortalLinkIconKey] : null
}
