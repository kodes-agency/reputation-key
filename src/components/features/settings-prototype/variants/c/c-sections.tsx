// PROTOTYPE — variant C. Which shared section renderer answers each row, and the one
// sentence the page header says about it. The renderers are the scaffold's
// (sections/), the same for every variant; this is only the lookup.
import type { ComponentType } from 'react'
import { AiSection } from '../../sections/prototype-ai-section'
import {
  DetailsSection,
  GoogleSection,
  PeopleSection,
  PortalsSection,
} from '../../sections/prototype-business-sections'
import {
  AddLocationSection,
  DangerSection,
} from '../../sections/prototype-danger-sections'
import { LookSection } from '../../sections/prototype-look-section'
import { NotificationsSection } from '../../sections/prototype-notifications-section'
import { OverviewSection } from '../../sections/prototype-overview-section'
import { RepliesSection } from '../../sections/prototype-replies-section'
import type { SectionProps } from '../../sections/prototype-section-kit'
import {
  DefaultTargetsSection,
  TargetsSection,
} from '../../sections/prototype-targets-section'
import {
  GoogleAccountsSection,
  TeamSection,
  WorkspaceSection,
} from '../../sections/prototype-team-sections'
import { ProfileSection, SecuritySection } from '../../sections/prototype-you-sections'
import type { SectionKey } from '../../settings-prototype-types'

const SECTION_BODY: Readonly<Record<SectionKey, ComponentType<SectionProps>>> = {
  overview: OverviewSection,
  'default-targets': DefaultTargetsSection,
  details: DetailsSection,
  google: GoogleSection,
  replies: RepliesSection,
  ai: AiSection,
  people: PeopleSection,
  look: LookSection,
  targets: TargetsSection,
  portals: PortalsSection,
  team: TeamSection,
  workspace: WorkspaceSection,
  'google-accounts': GoogleAccountsSection,
  profile: ProfileSection,
  notifications: NotificationsSection,
  security: SecuritySection,
  'add-location': AddLocationSection,
  danger: DangerSection,
}

/** One sentence of purpose under the title, and nothing else (PageHeader's `description`). */
export const SECTION_BLURB: Readonly<Record<SectionKey, string>> = {
  overview: 'What each property still needs, and who has set it up.',
  'default-targets': 'The response targets every property follows unless it has its own.',
  details: 'Name, category and time zone, as guests and your team see them.',
  google: 'The Google account and the listing your reviews come through.',
  replies: 'How RepKey writes back to Google reviews.',
  ai: 'Whether AI may help with replies, and which tools it may use.',
  people: 'Who is responsible for answering here.',
  look: 'The colours, logo and wording every portal shares.',
  targets: 'How quickly your team aims to answer.',
  portals: 'Where guests leave a rating.',
  team: 'Everyone with access, and what they can do.',
  workspace: 'The account your team and your locations live under.',
  'google-accounts': 'The Google accounts your locations are read through.',
  profile: 'Your name, how you appear and how RepKey looks for you.',
  notifications: 'What you are told about, and how.',
  security: 'Your password and where you are signed in.',
  'add-location': 'Bring another business into RepKey.',
  danger: 'Things that cannot be undone.',
}

/** The open section. Keyed by property so switching one puts the fixture values back. */
export function SectionBody({ ctx }: SectionProps) {
  const Body = SECTION_BODY[ctx.current.key]
  return <Body key={`${ctx.current.key}:${ctx.state.propertyId ?? 'all'}`} ctx={ctx} />
}
