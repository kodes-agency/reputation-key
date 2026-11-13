import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { useStaffAccounts } from './staff-accounts-context'
import { useStaffFunctions } from './staff-account-functions'
export function StaffColleagueSetting() {
  const accounts = useStaffAccounts()
  const functions = useStaffFunctions()
  const setting = useActionMutation(functions.setColleagueListEnabled, {
    errorMessage: actionErrorMessage,
    onSuccess: () => accounts?.refresh(),
  })
  if (!accounts?.canSettings) return null
  return (
    <SettingSwitchRow
      id="staff-colleague-list"
      label="Show staff each other's scans"
      description="Everyone at this property sees all staff scan counts, in name order."
      checked={accounts.colleagueListEnabled}
      commit="immediate"
      disabled={accounts.ready === false}
      pending={setting.isPending}
      onCheckedChange={(enabled) =>
        setting({ data: { propertyId: accounts.propertyId, enabled } })
      }
    />
  )
}
