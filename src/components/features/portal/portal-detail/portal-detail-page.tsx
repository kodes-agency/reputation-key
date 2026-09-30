// Portal detail page — the body of the workspace's editor route. Which tab is
// showing comes from the route's typed search state, and the tab strip itself
// lives in the workspace header (portal-workspace/), so this page renders one
// tab's content and nothing around it.
// It owns the drafts that must outlive a tab switch (theme colours) and nothing
// else: the once-shown public link is held by the workspace layout, every
// branch behind what is on screen lives in portal-detail-rules.ts, and every
// tab body in portal-detail-tab-panel.tsx.

import { useCallback, useRef, useState } from 'react'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { PortalDetailPreview } from './portal-detail-preview'
import { PortalDetailTabPanel } from './portal-detail-tab-panel'
import { PortalPreviewToggle } from './portal-preview-toggle'
import { PortalUnsavedChangesPrompt } from './portal-unsaved-changes-prompt'
import { derivePortalDetailView, isThemeDraftDirty } from './portal-detail-rules'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import { PortalWorkspaceBodyFrame } from '../portal-workspace/portal-workspace-body-frame'
import { usePortalLinkIssuance } from '../portal-workspace/portal-link-issuance'
import type { FormLike, PortalThemeDraft } from '../shared/types'
import type { PortalDetailPageProps } from './portal-detail-types'

export function PortalDetailPage(props: PortalDetailPageProps) {
  const { portal, organizationName, categories, links, activeTab } = props
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)
  const editFormRef = useRef<FormLike | null>(null)
  const issuance = usePortalLinkIssuance()
  const { has } = useCapabilities()

  // Keyed on the colour values, not on `portal.theme`'s identity: the detail
  // query hands back a fresh theme object on every refetch, which would discard
  // an in-progress edit (and silently clear the unsaved-changes guard below).
  const { primaryColor, backgroundColor, textColor } = portal.theme
  const themeSource = `${primaryColor}\u0000${backgroundColor}\u0000${textColor}`
  const [themeOverride, setThemeOverride] = useState<{
    source: string
    value: PortalThemeDraft
  } | null>(null)
  const theme = themeOverride?.source === themeSource ? themeOverride.value : portal.theme
  const setTheme = (next: PortalThemeDraft) => {
    setThemeOverride({ source: themeSource, value: next })
  }

  const view = derivePortalDetailView(activeTab, has('dashboard.use'))

  const themeDirty = isThemeDraftDirty(theme, portal.theme)
  const hasUnsavedChanges = useCallback(
    () => themeDirty || editFormRef.current?.hasUnsavedChanges() === true,
    [themeDirty],
  )

  return (
    <PortalWorkspaceBodyFrame>
      <div className="space-y-6">
        <PortalUnsavedChangesPrompt isDirty={hasUnsavedChanges} />

        <PortalPreviewToggle
          show={view.showPreview}
          open={previewOpen}
          onToggle={setPreviewOpen}
        />

        {/* The panel forwards the route-owned resources untouched; the page's own
          props (organizationName, activeTab) are unused there. */}
        <PortalDetailTabPanel
          {...props}
          {...issuance}
          tab={view.tab}
          theme={theme}
          onThemeChange={setTheme}
          formRef={editFormRef}
        />

        <PortalDetailPreview
          show={view.showPreview}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          portal={portal}
          organizationName={organizationName}
          theme={theme}
          categories={categories}
          links={links}
        />
      </div>
    </PortalWorkspaceBodyFrame>
  )
}
