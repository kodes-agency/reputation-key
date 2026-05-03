import { createFileRoute, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  component: OrganizationSettings,
})

function OrganizationSettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Organization</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Organization name, slug, and billing information.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Organization settings form will appear here.
      </div>
    </>
  )
}
