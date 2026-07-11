import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { changePasswordFn } from '#/contexts/identity/server/auth-settings'
import { SecuritySettingsForm } from '#/components/features/identity'

export const Route = createFileRoute('/_authenticated/settings/security')({
  component: SecuritySettings,
})

function SecuritySettings() {
  const changePassword = useActionMutation(changePasswordFn, {
    successMessage: 'Password changed successfully',
  })

  return (
    <>
      <PageHeader
        title="Security"
        description="Manage your password and account security."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Security' }]}
      />
      <SecuritySettingsForm changePassword={changePassword} />
    </>
  )
}
