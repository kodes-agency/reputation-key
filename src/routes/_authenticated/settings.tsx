// Settings layout route — separate sidebar with settings navigation.
// Nested under _authenticated so role context is available.
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import { SettingsSidebar } from '#/components/layout/SettingsSidebar'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <SidebarProvider>
      <SettingsSidebar />
      <SidebarInset>
        <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
