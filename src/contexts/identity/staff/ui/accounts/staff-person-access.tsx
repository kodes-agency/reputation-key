import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useStaffAccounts } from './staff-accounts-context'
import { useStaffFunctions } from './staff-account-functions'
import { staffProblem } from './staff-batch'
import { StaffRetry } from './staff-member-actions'
import type { StaffMember } from './staff-account-view'

export function StaffPersonAccess({
  member,
  onChangeEmail,
  onBusyChange,
}: Readonly<{
  member: StaffMember
  onChangeEmail: () => void
  onBusyChange: (busy: boolean) => void
}>) {
  const accounts = useStaffAccounts()!
  const functions = useStaffFunctions()
  const [repairing, setRepairing] = useState(false)
  const resend = useActionMutation(functions.resendStaffInvitation, {
    successMessage: 'Invitation sent',
    onSuccess: () => accounts.refresh(),
    onError: () => accounts.refresh(),
  })
  const busy = repairing || resend.isPending
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
  const pending = member.access === 'invited' || member.access === 'invite_expired'
  return (
    <>
      {member.code ? (
        <p className="text-sm" role="status">
          {staffProblem(member.code)}
        </p>
      ) : null}
      {member.access === 'failed' ? (
        <StaffRetry member={member} onBusyChange={setRepairing} />
      ) : null}
      {pending && accounts.canInvite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            pending={resend.isPending}
            pendingLabel="Sending…"
            onClick={() =>
              void resend({ data: { participationId: member.participationId } }).catch(
                () => undefined,
              )
            }
          >
            Resend invitation
          </Button>
          <Button variant="link" disabled={busy} onClick={onChangeEmail}>
            Change email
          </Button>
        </div>
      ) : null}
      <FormErrorBanner error={resend.error} />
    </>
  )
}
