// The drawn form of each icon in the closed catalogue a tile may carry
// (`src/shared/domain/portal-link-icon.ts`). The keys are lucide names; typing
// the table as a full record makes a key added to the catalogue a compile
// error here until it has a glyph.

import {
  BedDouble,
  BookOpen,
  Calendar,
  Camera,
  Car,
  Clock,
  Coffee,
  ConciergeBell,
  ExternalLink,
  Gift,
  Globe,
  Heart,
  Info,
  Link as LinkGlyph,
  Mail,
  MapPin,
  Music,
  Phone,
  Scissors,
  ShoppingBag,
  Sparkles,
  Star,
  Ticket,
  Utensils,
  Waves,
  Wifi,
  Wine,
  type LucideIcon,
} from 'lucide-react'
import {
  PORTAL_LINK_ICON_KEYS,
  parsePortalLinkIconKey,
  type PortalLinkIconKey,
} from '#/shared/domain/portal-link-icon'

export const LINK_ICONS: Readonly<Record<PortalLinkIconKey, LucideIcon>> = {
  link: LinkGlyph,
  'external-link': ExternalLink,
  globe: Globe,
  utensils: Utensils,
  coffee: Coffee,
  wine: Wine,
  'bed-double': BedDouble,
  'map-pin': MapPin,
  phone: Phone,
  mail: Mail,
  calendar: Calendar,
  clock: Clock,
  star: Star,
  gift: Gift,
  'shopping-bag': ShoppingBag,
  music: Music,
  ticket: Ticket,
  wifi: Wifi,
  car: Car,
  info: Info,
  heart: Heart,
  scissors: Scissors,
  sparkles: Sparkles,
  camera: Camera,
  'book-open': BookOpen,
  waves: Waves,
  'concierge-bell': ConciergeBell,
}

/** The icons the picker offers, in the catalogue's order. */
export const LINK_ICON_CHOICES: ReadonlyArray<PortalLinkIconKey> = PORTAL_LINK_ICON_KEYS

/** A tile with no icon, or one the catalogue does not know, wears the plain link glyph. */
export function linkIconKeyOrDefault(key: string | null): PortalLinkIconKey {
  return parsePortalLinkIconKey(key) ?? 'link'
}

/** The words a screen reader gets for an icon choice: `bed-double` reads "Bed double". */
export function linkIconLabel(key: PortalLinkIconKey): string {
  const words = key.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
