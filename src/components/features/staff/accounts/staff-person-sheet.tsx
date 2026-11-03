import type { Action } from '#/components/hooks/use-action'
import type { StaffMember } from './staff-account-view'
import { StaffPersonAccess } from './staff-person-access'
import { moveStaffPerson } from './staff-group-actions'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetDescription,
  SheetFooter,
} from '#/components/ui/sheet'
import { RESPONSIVE_DETAIL_SHEET, SheetDetailTitle } from '#/components/ui/sheet-layouts'
import { Pencil } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { ConfirmationTrigger } from '#/components/ui/confirmation-dialog'
import { useDismissalGuard } from '#/components/ui/dialog-dismissal'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useStaffAccounts } from './staff-accounts-context'
import { useStaffFunctions } from './staff-account-functions'
import { StaffRemoveDialog } from './staff-member-actions'
import { staffAccessLine, staffMemberMenu } from './staff-account-view'
import { StaffPersonEdit } from './staff-person-edit'
import { StaffPersonResults } from './staff-person-results'
import { StaffPersonPortals } from './staff-person-portals'

export function StaffPersonSheet({
  participationId,
  onClose,
  onRestoreFocus,
}: Readonly<{
  participationId: string
  onClose: () => void
  onRestoreFocus?: () => void
}>) {
  const accounts = useStaffAccounts()!
  const member = accounts.members.find(
    (person) => person.participationId === participationId,
  )
  const functions = useStaffFunctions()
  const [editing, setEditing] = useState<'name' | 'email' | null>(null)
  const [repairing, setRepairing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const refresh = () => accounts.refresh().then(() => undefined)
  const rename = useActionMutation(
    async (displayName: string) =>
      functions.renameStaffMember({ data: { participationId, displayName } }),
    { onSuccess: refresh },
  )
  const email = useActionMutation(
    async (value: string) =>
      functions.changeStaffInvitationEmail({ data: { participationId, email: value } }),
    { onSuccess: refresh, onError: refresh },
  )
  const remove = useActionMutation(functions.removeStaffMember, {
    onSuccess: async () => {
      onClose()
      await refresh()
    },
  })
  const move = useActionMutation(
    async (group: string) => {
      if (member) return moveStaffPerson(functions, member, group)
    },
    { onSuccess: refresh },
  )
  const busy =
    repairing || rename.isPending || email.isPending || remove.isPending || move.isPending
  const { guard } = useDismissalGuard(busy)
  if (!member) return null
  const menu = staffMemberMenu(member, {
    invite: accounts.canInvite,
    remove: accounts.canRemove,
  })
  const pending = member.access === 'invited' || member.access === 'invite_expired'
  const done = (
    <Button variant="outline" disabled={busy} onClick={onClose}>
      Done
    </Button>
  )
  return (
    <Sheet
      open
      onOpenChange={guard((open) => {
        if (!open) onClose()
      })}
    >
      <SheetContent
        layout={RESPONSIVE_DETAIL_SHEET}
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) {
            event.preventDefault()
            onRestoreFocus()
          }
        }}
      >
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetDetailTitle className="min-w-0 break-words">
              {member.displayName}
            </SheetDetailTitle>
            {menu.includes('rename') ? (
              <IconButton
                label="Rename"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing('name')}
              >
                <Pencil />
              </IconButton>
            ) : null}
          </div>
          <SheetDescription className="break-words">
            {[member.email, staffAccessLine(member.access)].filter(Boolean).join(' · ')}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4">
          <StaffIdentityEdit
            member={member}
            editing={editing}
            rename={rename}
            email={email}
            onCancel={() => setEditing(null)}
          />
          <StaffPersonResults member={member} propertyId={accounts.propertyId} />
          <StaffPersonPortals member={member} move={move} />
          <StaffPersonAccess
            member={member}
            onChangeEmail={() => setEditing('email')}
            onBusyChange={setRepairing}
          />
          <div className="flex justify-between gap-2 border-t pt-4">
            {menu.includes('remove') ? (
              <ConfirmationTrigger
                tone="destructive"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                {pending ? 'Cancel invitation' : 'Remove'}
              </ConfirmationTrigger>
            ) : null}
            <div className="hidden md:block">{done}</div>
          </div>
        </div>
        <SheetFooter variant="safe-area-actions">{done}</SheetFooter>
        <StaffRemoveDialog
          member={member}
          open={removing}
          onOpenChange={setRemoving}
          onConfirm={() => remove({ data: { participationId } })}
        />
      </SheetContent>
    </Sheet>
  )
}

function StaffIdentityEdit({
  member,
  editing,
  rename,
  email,
  onCancel,
}: Readonly<{
  member: StaffMember
  editing: 'name' | 'email' | null
  rename: Action<string>
  email: Action<string>
  onCancel: () => void
}>) {
  return (
    <>
      {editing ? (
        <StaffPersonEdit
          key={editing}
          kind={editing}
          value={editing === 'name' ? member.displayName : (member.email ?? '')}
          action={editing === 'name' ? rename : email}
          onCancel={onCancel}
        />
      ) : null}
    </>
  )
}
