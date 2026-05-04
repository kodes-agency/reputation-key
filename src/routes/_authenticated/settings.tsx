// Settings layout route — renders within the authenticated layout's SidebarProvider.
// The authenticated layout swaps to SettingsSidebar when on /settings/* routes.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
      <Outlet />
    </div>
  )
}
