// PROTOTYPE — variant A (Editor rail). The rail's icon per row and the one line of
// purpose under each section's title. Wording follows the shape: at one property it
// says "business" and never "property", "organization" or "default".
import {
  Bell,
  BrainCircuit,
  Building2,
  Clock,
  KeyRound,
  LayoutGrid,
  Link2,
  MessageSquareText,
  Palette,
  Plus,
  Shield,
  Store,
  Timer,
  TriangleAlert,
  User,
  UserRoundCheck,
  Users,
  Globe,
  type LucideIcon,
} from 'lucide-react'
import type { SectionKey, SettingsShape } from '../../settings-prototype-types'

export const SECTION_ICON: Readonly<Record<SectionKey, LucideIcon>> = {
  overview: LayoutGrid,
  'default-targets': Timer,
  details: Store,
  google: Link2,
  replies: MessageSquareText,
  ai: BrainCircuit,
  people: UserRoundCheck,
  look: Palette,
  targets: Clock,
  portals: Globe,
  team: Users,
  workspace: Building2,
  'google-accounts': KeyRound,
  profile: User,
  notifications: Bell,
  security: Shield,
  'add-location': Plus,
  danger: TriangleAlert,
}

/** One line under the section's title: what the page is for. */
export function purposeOf(key: SectionKey, shape: SettingsShape): string {
  const noun = shape.showPropertySwitcher ? 'property' : 'business'
  switch (key) {
    case 'overview':
      return 'Every property at a glance, and what each one still needs.'
    case 'default-targets':
      return 'The targets every property follows unless it has its own.'
    case 'details':
      return `The name, category and time zone for this ${noun}.`
    case 'google':
      return `The Google account and listing this ${noun} reads reviews from.`
    case 'replies':
      return 'How RepKey writes back to Google reviews.'
    case 'ai':
      return `Whether AI may draft replies for this ${noun}.`
    case 'people':
      return 'Who is told first about new reviews and private feedback.'
    case 'look':
      return 'The colours and photo every portal wears.'
    case 'targets':
      return shape.showPropertySwitcher
        ? 'How quickly this property aims to answer: follow the default or set its own.'
        : 'How quickly your team aims to answer.'
    case 'portals':
      return 'Where guests leave a rating. Each portal has its own wording.'
    case 'team':
      return 'Who can do what in this workspace.'
    case 'workspace':
      return 'The name and contact behind your account.'
    case 'google-accounts':
      return 'The Google accounts your properties read reviews from.'
    case 'profile':
      return 'Your name, time zone and how RepKey looks to you.'
    case 'notifications':
      return 'What reaches you, and how.'
    case 'security':
      return 'Your password, and where you are signed in.'
    case 'add-location':
      return 'Bring in another location from Google.'
    case 'danger':
      return 'Actions that cannot be taken back.'
  }
}
