import { createFileRoute } from '@tanstack/react-router'
import { SecuritySettingsForm } from '#/components/features/identity/security-settings-form'

export const Route = createFileRoute('/_authenticated/settings/security')({
  component: SecuritySettings,
})

function SecuritySettings() {
  return <SecuritySettingsForm />
}
