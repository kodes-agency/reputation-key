// The Page tab: the section list, the active section and the live preview, in
// three columns from `xl`; from `lg` the list is a row above the section and
// its preview, and below `lg` the preview stacks under the section. Which
// section is showing comes from the route's `?section=`, and every save goes
// through the portal's autosave coordinator.

import { useNavigate } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalPreviewPane } from '../portal-preview/portal-preview-pane'
import type { PreviewPartSection } from '../portal-preview/preview-parts'
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
import type { PortalEditorResources } from './portal-editor-types'

type Props = Readonly<{
  resources: PortalEditorResources
  /** The section the URL asks for; the editor falls back when it is not offered. */
  requestedSection: PortalEditorSection | undefined
}>

export function PortalEditor({ resources, requestedSection }: Props) {
  const { can } = usePermissions()
  const navigate = useNavigate()
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
  // A click on a part of the preview opens its section, as its link in the list does.
  const openSection = (next: PreviewPartSection) =>
    void navigate({
      to: '/properties/$propertyId/portals/$portalId',
      params: { propertyId, portalId: portal.id },
      search: { tab: 'page', section: next },
    })

  return (
    // The form and its preview sit side by side from lg (iPad landscape, a
    // small laptop), so an edit is seen as it is typed; the section list joins
    // them as a column only from xl, where there is room for three.
    <div className="flex min-h-full flex-col xl:flex-row">
      <PortalEditorNav
        propertyId={propertyId}
        portalId={portal.id}
        active={section}
        available={available}
        summaries={summaries}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
          <div className="mx-auto max-w-2xl space-y-6">
            <PortalEditorSectionPanel
              section={section}
              group={group}
              resources={resources}
              canEdit={canEdit}
            />
          </div>
        </div>
        <aside
          aria-label="Live preview"
          className="border-t bg-muted/20 px-4 py-5 md:px-8 lg:sticky lg:top-0 lg:max-h-dvh lg:w-[26rem] lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-6 xl:w-[30rem]"
        >
          <PortalPreviewPane
            portalId={portal.id}
            getPortalPreview={resources.getPortalPreview}
            selection={{ active: section, onSelect: openSection, canEdit }}
          />
        </aside>
      </div>
    </div>
  )
}
