// The body of the active editor section. The route mounts exactly one section,
// so this switch is the single decision about what a section shows.

import { FooterSection } from './sections/footer-section'
import { GroupSection } from './sections/group-section'
import { LanguagesSection } from './sections/languages-section'
import { LinktreeSection } from './sections/linktree-section'
import { LookSection } from './sections/look-section'
import { PrivateNoteSection } from './sections/private-note-section'
import { RatingSection } from './sections/rating-section'
import { ResponsibleSection } from './sections/responsible-section'
import { WelcomeSection } from './sections/welcome-section'
import type { PortalEditorSection } from './portal-editor-sections'
import type { PortalGroupView } from '../portal-group/portal-group-types'
import type { PortalEditorSectionProps } from './portal-editor-types'

type Props = PortalEditorSectionProps &
  Readonly<{
    section: PortalEditorSection
    /** The group the portal is in; null for none. Only read by the Group section. */
    group: PortalGroupView | null
  }>

export function PortalEditorSectionPanel({ section, group, ...shared }: Props) {
  switch (section) {
    case 'look':
      return <LookSection {...shared} />
    case 'welcome':
      return <WelcomeSection {...shared} />
    case 'rating':
      return <RatingSection {...shared} />
    case 'private-note':
      return <PrivateNoteSection {...shared} />
    case 'linktree':
      return <LinktreeSection {...shared} />
    case 'footer':
      return <FooterSection />
    case 'languages':
      return <LanguagesSection {...shared} />
    case 'group':
      return <GroupSection propertyId={shared.resources.propertyId} group={group} />
    case 'responsible':
      return <ResponsibleSection {...shared} />
  }
}
