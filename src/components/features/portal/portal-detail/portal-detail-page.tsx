// Portal detail page — tabbed layout controlled by typed route search state.
// The shell owns the drafts that must outlive a tab switch (theme colours, the
// once-shown public link) and nothing else: every branch behind what is on
// screen lives in portal-detail-rules.ts, and every tab body in
// portal-detail-tab-panel.tsx.

import { useCallback, useRef, useState } from 'react'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { PortalDetailHeader } from './portal-detail-header'
import { PortalDetailPreview } from './portal-detail-preview'
import { PortalDetailTabPanel } from './portal-detail-tab-panel'
import { PortalDetailTabs } from './portal-detail-tabs'
import { PortalUnsavedChangesPrompt } from './portal-unsaved-changes-prompt'
import { derivePortalDetailView, isThemeDraftDirty } from './portal-detail-rules'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import type { IssuedPortalLink } from '../portal-share/portal-share-types'
import type { FormLike, PortalThemeDraft } from '../shared/types'
import type { PortalDetailPageProps } from './portal-detail-types'

export function PortalDetailPage(props: PortalDetailPageProps) {
  const {
    portal,
    propertyId,
    organizationName,
    categories,
    links,
    activeTab,
    onTabChange,
  } = props
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)
  const editFormRef = useRef<FormLike | null>(null)
  const [issuedPortalLink, setIssuedPortalLink] = useState<IssuedPortalLink | null>(null)
  const [linksRevoked, setLinksRevoked] = useState(false)
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
    <div className="space-y-6">
      <PortalUnsavedChangesPrompt isDirty={hasUnsavedChanges} />

      <PortalDetailHeader
        propertyId={propertyId}
        showPreview={view.showPreview}
        previewOpen={previewOpen}
        onPreviewToggle={setPreviewOpen}
      />

      <PortalDetailTabs
        value={view.tab}
        onValueChange={onTabChange}
        hiddenTabs={view.hiddenTabs}
      >
        {/* The panel forwards the route-owned resources untouched; the shell's
            own props (organizationName, activeTab, onTabChange) are unused there. */}
        <PortalDetailTabPanel
          {...props}
          tab={view.tab}
          theme={theme}
          onThemeChange={setTheme}
          formRef={editFormRef}
          issuedLink={issuedPortalLink}
          linksRevoked={linksRevoked}
          onLinkIssued={(link) => {
            setIssuedPortalLink({ publicUrl: link.publicUrl })
            setLinksRevoked(false)
          }}
          onLinksRevoked={() => {
            setIssuedPortalLink(null)
            setLinksRevoked(true)
          }}
        />
      </PortalDetailTabs>

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
  )
}
