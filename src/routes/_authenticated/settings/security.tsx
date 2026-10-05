import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { changePasswordFn } from '#/contexts/identity/server/auth-settings'
import { ensureActiveOrg } from '#/shared/auth/auth.functions'
import { SecuritySettingsForm } from '#/components/features/identity'

export const Route = createFileRoute('/_authenticated/settings/security')({
  staticData: { page: { title: 'Security', under: 'settings' } },
  component: SecuritySettings,
})

function SecuritySettings() {
  const changePassword = useActionMutation(changePasswordFn, {
    successMessage: 'Password changed',
    // A password change revokes every other session and ROTATES this one
    // (revokeOtherSessions). The replacement session carries no active
    // organization, so without this the very next organization-scoped read
    // threw "No active organization selected" — every settings page broke
    // until the operator signed out and back in.
    onSuccess: async () => {
      await ensureActiveOrg()
    },
  })

  return (
    <>
      <PageHeader
        title="Security"
        description="Manage your password and account security."
        breadcrumbs={trailCrumbs('settings', {}, 'Security')}
      />
      <SecuritySettingsForm changePassword={changePassword} />
    </>
  )
}
