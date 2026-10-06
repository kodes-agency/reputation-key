// PROTOTYPE — one glyph per section, so a tile reads at a glance and a menu item
// carries the same mark as the tile it leads to.
import {
  Bell,
  Briefcase,
  Building2,
  KeyRound,
  LayoutGrid,
  Link2,
  MessageSquareText,
  PanelsTopLeft,
  Palette,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { SectionKey } from '../../settings-prototype-types'

export const SECTION_ICON: Readonly<Record<SectionKey, LucideIcon>> = {
  overview: LayoutGrid,
  'default-targets': Timer,
  details: Building2,
  google: Link2,
  replies: MessageSquareText,
  ai: Sparkles,
  people: UsersRound,
  look: Palette,
  targets: Timer,
  portals: PanelsTopLeft,
  team: UsersRound,
  workspace: Briefcase,
  'google-accounts': KeyRound,
  profile: UserRound,
  notifications: Bell,
  security: ShieldCheck,
  'add-location': Plus,
  danger: ShieldAlert,
}
