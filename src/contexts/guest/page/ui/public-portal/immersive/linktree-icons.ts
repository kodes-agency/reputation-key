import {
  ArrowUpRight,
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
  Link,
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
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'

/** The mark on every tile that opens something outside the page. */
export const LinktreeArrow = ArrowUpRight

// One entry per key of the closed set a manager may choose (`PORTAL_LINK_ICON_KEYS`).
// `satisfies Record<PortalLinkIconKey, ...>` makes a key added to the set without
// an icon here a type error.
const ICONS = {
  link: Link,
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
} as const satisfies Readonly<Record<PortalLinkIconKey, LucideIcon>>

/**
 * The icon of a tile. A tile with no key shows the default link icon. A key the
 * map does not know (a snapshot written by a later release) draws nothing, never
 * another icon in its place.
 */
export function linktreeIconFor(key: string | null): LucideIcon | null {
  if (key === null) return ICONS.link
  return Object.hasOwn(ICONS, key) ? ICONS[key as PortalLinkIconKey] : null
}
