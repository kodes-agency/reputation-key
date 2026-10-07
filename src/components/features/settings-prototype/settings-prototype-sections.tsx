// PROTOTYPE — the shared section dispatcher: a section key -> its renderer. A variant
// draws the section's heading itself and asks for it `bare`; otherwise the heading is
// drawn here. Keyed by property and section so switching either puts the fixture
// values back (the fake forms remount).
import type { ComponentType } from 'react'
import { AiSection } from './sections/prototype-ai-section'
import {
  DetailsSection,
  GoogleSection,
  PeopleSection,
  PortalsSection,
} from './sections/prototype-business-sections'
import { AddLocationSection, DangerSection } from './sections/prototype-danger-sections'
import { LookSection } from './sections/prototype-look-section'
import { NotificationsSection } from './sections/prototype-notifications-section'
import { OverviewSection } from './sections/prototype-overview-section'
import { RepliesSection } from './sections/prototype-replies-section'
import { SectionHeading, type SectionProps } from './sections/prototype-section-kit'
import {
  DefaultTargetsSection,
  TargetsSection,
} from './sections/prototype-targets-section'
import {
  GoogleAccountsSection,
  TeamSection,
  WorkspaceSection,
} from './sections/prototype-team-sections'
import { ProfileSection, SecuritySection } from './sections/prototype-you-sections'
import type { SectionKey, SettingsPrototypeContext } from './settings-prototype-types'

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

export function SettingsPrototypeSection({
  ctx,
  bare = false,
}: Readonly<{ ctx: SettingsPrototypeContext; bare?: boolean }>) {
  const Renderer = RENDERERS[ctx.current.key]
  const body = (
    <Renderer key={`${ctx.state.propertyId ?? 'all'}:${ctx.current.key}`} ctx={ctx} />
  )
  if (bare) return body
  return (
    <div className="space-y-5">
      <SectionHeading title={ctx.current.label} />
      {body}
    </div>
  )
}
