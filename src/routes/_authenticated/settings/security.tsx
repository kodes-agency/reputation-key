import { createFileRoute } from '@tanstack/react-router'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { changePasswordFn } from '#/contexts/identity/server/auth-settings'
import { SecuritySettingsForm } from '#/components/features/identity'

export const Route = createFileRoute('/_authenticated/settings/security')({
  component: SecuritySettings,
})

function SecuritySettings() {
  const changePassword = useMutationAction(changePasswordFn, {
    successMessage: 'Password changed successfully',
  })

  return <SecuritySettingsForm changePassword={changePassword} />
}
