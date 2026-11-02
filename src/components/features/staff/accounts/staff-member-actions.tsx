import { StaffRenameDialog } from './staff-rename-dialog'
import { useStaffFunctions } from './staff-account-functions'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import { useStaffAccounts } from './staff-accounts-context'
import {
  staffMemberMenu,
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

export function StaffMemberMenu({ member }: Readonly<{ member: StaffMember }>) {
  const accounts = useStaffAccounts()
  const [dialog, setDialog] = useState<'rename' | 'remove' | null>(null)
  const { removeStaffMember, resendStaffInvitation } = useStaffFunctions()
  const remove = useActionMutation(removeStaffMember, {
    onSuccess: () => accounts?.refresh().then(() => undefined),
  })
  const resend = useActionMutation(resendStaffInvitation, {
    successMessage: 'Invitation sent',
    errorMessage: actionErrorMessage,
    onSuccess: () => accounts?.refresh().then(() => undefined),
  })
  if (!accounts) return null
  const menu = staffMemberMenu(member, {
    invite: accounts.canInvite,
    remove: accounts.canRemove,
  })
  return (
    <>
      <RowActionsMenu name={member.displayName}>
        {menu.includes('code') && member.portalId ? (
          <RowActionsItem asChild>
            <Link
              to="/properties/$propertyId/portals/$portalId"
              params={{ propertyId: accounts.propertyId, portalId: member.portalId }}
              search={{ tab: 'share' }}
            >
              Show code
            </Link>
          </RowActionsItem>
        ) : null}
        {menu.includes('rename') ? (
          <RowActionsItem opensDialog onSelect={() => setDialog('rename')}>
            Rename
          </RowActionsItem>
        ) : null}
        {menu.includes('resend') ? (
          <RowActionsItem
            pending={resend.isPending}
            onSelect={() => {
              void resend({ data: { participationId: member.participationId } }).catch(
                () => undefined,
              )
            }}
          >
            Resend invitation
          </RowActionsItem>
        ) : null}
        {menu.includes('remove') ? (
          <RowActionsItem destructive opensDialog onSelect={() => setDialog('remove')}>
            {member.access === 'invited' || member.access === 'invite_expired'
              ? 'Cancel invitation'
              : 'Remove'}
          </RowActionsItem>
        ) : null}
      </RowActionsMenu>
      <StaffRemoveDialog
        member={member}
        open={dialog === 'remove'}
        onOpenChange={(open) => setDialog(open ? 'remove' : null)}
        onConfirm={() => remove({ data: { participationId: member.participationId } })}
      />
      {dialog === 'rename' ? (
        <StaffRenameDialog member={member} onClose={() => setDialog(null)} />
      ) : null}
    </>
  )
}

export function StaffRetry({ member }: Readonly<{ member: StaffMember }>) {
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
      if (result.status !== 'done') throw new Error('Staff setup remains incomplete')
      return result
    },
    {
      errorMessage: actionErrorMessage,
      onSuccess: () => accounts?.refresh().then(() => undefined),
    },
  )
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
