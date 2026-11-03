import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { useEffect } from 'react'
import { useStaffFunctions } from './staff-account-functions'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { staffProblem } from './staff-batch'
import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { useStaffAccounts } from './staff-accounts-context'
import {
  staffRepairAction,
  staffRemovalWords,
  type StaffMember,
} from './staff-account-view'

export function StaffRemoveDialog({
  member,
  open,
  onOpenChange,
  onConfirm,
}: Readonly<{
  member: StaffMember
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<unknown>
}>) {
  return (
    <ConfirmationDialog
      {...staffRemovalWords(member, member.endsSignIn === true)}
      tone="destructive"
      cancelLabel="Keep staff member"
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  )
}

export function StaffRetry({
  member,
  onBusyChange,
}: Readonly<{ member: StaffMember; onBusyChange?: (busy: boolean) => void }>) {
  const accounts = useStaffAccounts()
  const { addStaffMember, removeStaffMember } = useStaffFunctions()
  const retry = useActionMutation(
    async () => {
      if (staffRepairAction(member) === 'remove')
        return removeStaffMember({ data: { participationId: member.participationId } })
      if (!accounts || !member.operationId || !member.email)
        throw new Error('Staff setup cannot be retried')
      const result = await addStaffMember({
        data: {
          propertyId: accounts.propertyId,
          operationId: member.operationId,
          email: member.email,
          displayName: member.displayName,
        },
      })
      if (result.status !== 'done')
        throw new ServerFunctionError(
          'StaffAccountError',
          staffProblem(result.code) ?? 'Staff setup remains incomplete.',
          result.code ?? 'step_failed',
          409,
        )
      return result
    },
    {
      errorMessage: actionErrorMessage,
      onSuccess: () => accounts?.refresh().then(() => undefined),
      onError: () => accounts?.refresh().then(() => undefined),
    },
  )
  useEffect(() => {
    onBusyChange?.(retry.isPending)
    return () => onBusyChange?.(false)
  }, [retry.isPending, onBusyChange])
  if (
    !accounts ||
    member.access !== 'failed' ||
    (member.step === 'removal' ? !accounts.canRemove : !accounts.canInvite)
  )
    return null
  return (
    <Button
      variant="outline"
      size="sm"
      pending={retry.isPending}
      pendingLabel="Trying again…"
      onClick={() => {
        void retry(undefined).catch(() => undefined)
      }}
    >
      Try again
    </Button>
  )
}

export function StaffInvitationRepair({ member }: Readonly<{ member: StaffMember }>) {
  const accounts = useStaffAccounts()
  const functions = useStaffFunctions()
  const resend = useActionMutation(functions.resendStaffInvitation, {
    successMessage: 'Invitation sent',
    errorMessage: actionErrorMessage,
    onSuccess: () => accounts?.refresh().then(() => undefined),
    onError: () => accounts?.refresh().then(() => undefined),
  })
  if (
    !accounts?.canInvite ||
    (member.access !== 'invite_expired' && member.code !== 'invitation_delivery_failed')
  )
    return null
  return (
    <Button
      variant="outline"
      size="sm"
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
  )
}
