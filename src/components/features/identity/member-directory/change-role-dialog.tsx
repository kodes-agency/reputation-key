// Change role: an explicit, explained confirmation in place of the old inline
// role dropdown. Controlled by the route so one dialog serves every row; the
// body mounts per open, which is what resets the chosen role for the next member.

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import type { Action } from '#/components/hooks/use-action'
import {
  isBetaInteractiveRole,
  type BetaInteractiveRole,
} from '#/shared/domain/beta-interactive-role'
import type { Role } from '#/shared/domain/roles'
import { RoleChoice } from './role-choice'
import { describeRoleChange } from './role-change'

export type RoleChangeTarget = Readonly<{
  id: string
  name: string
  role: Role | null
}>

type UpdateRoleAction = Action<{
  data: { memberId: string; role: BetaInteractiveRole }
}>

type Props = Readonly<{
  /** The member whose role is being changed; null keeps the dialog closed. */
  member: RoleChangeTarget | null
  onClose: () => void
  allowedRoles: ReadonlyArray<BetaInteractiveRole>
  /**
   * The route's Action reports its own outcome (toasts); a refusal still
   * rejects the call, so the click settles the promise rather than leaking it.
   */
  updateRoleAction: UpdateRoleAction
}>

function ChangeRoleBody({
  member,
  onClose,
  allowedRoles,
  updateRoleAction,
}: Props & Readonly<{ member: RoleChangeTarget }>) {
  const [chosen, setChosen] = useState<BetaInteractiveRole | null>(
    member.role !== null && isBetaInteractiveRole(member.role) ? member.role : null,
  )
  const change = describeRoleChange(member.role, chosen, member.name)

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Change role for {member.name}</AlertDialogTitle>
        <AlertDialogDescription>
          Pick the role {member.name} should have in your organization.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <RoleChoice
        value={chosen}
        onValueChange={setChosen}
        allowedRoles={allowedRoles}
        idPrefix="change-role"
        aria-label={`Role for ${member.name}`}
        disabled={updateRoleAction.isPending}
      />
      <p className="text-sm" role="status">
        {change.note}
      </p>
      <AlertDialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!change.canConfirm || updateRoleAction.isPending || chosen === null}
          onClick={() => {
            if (chosen === null) return
            void updateRoleAction({ data: { memberId: member.id, role: chosen } })
              .then(onClose)
              .catch(() => undefined)
          }}
        >
          {updateRoleAction.isPending ? 'Changing…' : 'Change role'}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

export function ChangeRoleDialog(props: Props) {
  const { member, onClose } = props
  return (
    <AlertDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        {member ? <ChangeRoleBody key={member.id} {...props} member={member} /> : null}
      </AlertDialogContent>
    </AlertDialog>
  )
}
