// Portal detail page — the body of the workspace's editor route. Which tab is
// showing comes from the route's typed search state, and the tab strip itself
// lives in the workspace header (portal-workspace/), so this page renders one
// tab's content and nothing around it.
//
// The Page tab is the section editor (portal-editor/), which carries the live
// preview beside the section; the other tabs are the interim bodies in
// portal-detail-tab-panel.tsx. The page owns what must outlive a section
// switch — the palette draft — and the navigation guard; the once-shown public
// link is held by the workspace layout, and every branch behind what is on
// screen lives in portal-detail-rules.ts.

import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { PortalEditor } from '../portal-editor/portal-editor'
import { usePortalThemeAutosave } from '../portal-editor/use-portal-theme-autosave'
import { usePortalLinkIssuance } from '../portal-workspace/portal-link-issuance'
import { PortalWorkspaceBodyFrame } from '../portal-workspace/portal-workspace-body-frame'
import { derivePortalDetailView } from './portal-detail-rules'
import { PortalDetailTabPanel } from './portal-detail-tab-panel'
import { PortalUnsavedChangesPrompt } from './portal-unsaved-changes-prompt'
import type { PortalDetailPageProps } from './portal-detail-types'

export function PortalDetailPage(props: PortalDetailPageProps) {
  const { portal, activeTab, activeSection } = props
  const issuance = usePortalLinkIssuance()
  const { has } = useCapabilities()
  const { theme, setTheme } = usePortalThemeAutosave(portal, props.autosaveUpdateMutation)

  const view = derivePortalDetailView(activeTab, has('dashboard.use'))

  return (
    <>
      <PortalUnsavedChangesPrompt />

      {view.tab === 'page' ? (
        <PortalEditor
          resources={props}
          requestedSection={activeSection}
          theme={theme}
          onThemeChange={setTheme}
        />
      ) : view.tab === 'history' ? (
        // The ledger and its Versions rail run edge to edge, like the editor.
        <PortalDetailTabPanel {...props} {...issuance} tab={view.tab} />
      ) : (
        <PortalWorkspaceBodyFrame wide={view.tab === 'results'}>
          <PortalDetailTabPanel {...props} {...issuance} tab={view.tab} />
        </PortalWorkspaceBodyFrame>
      )}
    </>
  )
}
