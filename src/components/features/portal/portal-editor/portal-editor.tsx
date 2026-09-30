// The Page tab: the section list beside the active section. Which section is
// showing comes from the route's `?section=`; the drafts that must outlive a
// section switch (the palette) are owned by the page above, and every save goes
// through the portal's autosave coordinator.
//
// The live preview joins as a third column in slice 30; until then the existing
// preview toggle sits above the section.

import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalPreviewToggle } from '../portal-detail/portal-preview-toggle'
import { PortalEditorNav } from './portal-editor-nav'
import { PortalEditorSectionPanel } from './portal-editor-section-panel'
import {
  availablePortalEditorSections,
  resolvePortalEditorSection,
  type PortalEditorSection,
} from './portal-editor-sections'
import {
  findPortalGroup,
  responsibleManagerNames,
  summarizePortalEditorSections,
} from './portal-editor-summary'
import type {
  PortalEditorResources,
  PortalEditorThemeControls,
} from './portal-editor-types'

type Props = PortalEditorThemeControls &
  Readonly<{
    resources: PortalEditorResources
    /** The section the URL asks for; the editor falls back when it is not offered. */
    requestedSection: PortalEditorSection | undefined
    previewOpen: boolean
    onPreviewToggle: (open: boolean) => void
  }>

export function PortalEditor({
  resources,
  requestedSection,
  theme,
  onThemeChange,
  previewOpen,
  onPreviewToggle,
}: Props) {
  const { can } = usePermissions()
  const { portal, propertyId, portalGroups, links } = resources
  const group = portalGroups ? findPortalGroup(portalGroups, portal.id) : null
  const hasResponsible =
    resources.responsibleManagers !== undefined &&
    resources.responsibleManagerMembers !== undefined &&
    resources.updateResponsibleManagersMutation !== undefined
  const available = availablePortalEditorSections({
    group: portalGroups !== undefined,
    responsible: hasResponsible,
  })
  const section = resolvePortalEditorSection(requestedSection, available)
  const summaries = summarizePortalEditorSections({
    portalName: portal.name,
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    linkCount: links.length,
    languageCount: 1 + (portal.additionalGuestLocales?.length ?? 0),
    missingTextCount: resources.languageCoverage?.missingTotal,
    groupName: group?.name ?? null,
    responsibleNames: responsibleManagerNames(
      resources.responsibleManagers?.assignments ?? [],
      resources.responsibleManagerMembers ?? [],
    ),
  })
  // An archived portal is read-only even for a `portal.update` holder: its
  // configuration and history are retained exactly as they were.
  const canEdit = can('portal.update') && portal.publicationState !== 'archived'

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <PortalEditorNav
        propertyId={propertyId}
        portalId={portal.id}
        active={section}
        available={available}
        summaries={summaries}
      />
      <div className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <PortalPreviewToggle show open={previewOpen} onToggle={onPreviewToggle} />
          <PortalEditorSectionPanel
            section={section}
            group={group}
            resources={resources}
            canEdit={canEdit}
            theme={theme}
            onThemeChange={onThemeChange}
          />
        </div>
      </div>
    </div>
  )
}
