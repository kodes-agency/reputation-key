// PROTOTYPE — variant A. The shared section renderers by key. Keyed by property and
// section so switching either puts the fixture values back (the fake forms remount).
import type { ComponentType } from 'react'
import type { SectionKey } from '../../settings-prototype-types'
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

const RENDERERS: Readonly<Record<SectionKey, ComponentType<SectionProps>>> = {
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

export function VariantASection({ ctx }: SectionProps) {
  const Renderer = RENDERERS[ctx.current.key]
  return (
    <Renderer key={`${ctx.state.propertyId ?? 'all'}:${ctx.current.key}`} ctx={ctx} />
  )
}
