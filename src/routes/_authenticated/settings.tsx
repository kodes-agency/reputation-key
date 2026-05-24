// Settings layout route — renders within the authenticated layout's SidebarProvider.
// The authenticated layout swaps to SettingsSidebar when on /settings/* routes.
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <PageShell>
      <Outlet />
    </PageShell>
  )
}
