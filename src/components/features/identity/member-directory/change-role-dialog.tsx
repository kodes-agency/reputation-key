// Change role: an explicit, explained confirmation in place of the old inline
// role dropdown. Controlled by the route so one dialog serves every row; the
// body mounts per open, which is what resets the chosen role for the next member.
// It is the one ConfirmationDialog: it cannot be left while the change is in
// flight (its success closes the route's one dialog, which by then could be
// another member's), and a refusal stays in it, said once.

import { useState } from 'react'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
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
   * The confirmation stays open while it runs and says a refusal in place, so
   * the route's Action does not also toast one.
   */
  updateRoleAction: UpdateRoleAction
}>

function ChangeRoleConfirmation({
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
    <ConfirmationDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`Change role for ${member.name}`}
      description={`Pick the role ${member.name} should have in your organization.`}
      cancelLabel="Cancel"
      confirmLabel="Change role"
      pendingLabel="Changing…"
      confirmDisabled={!change.canConfirm || chosen === null}
      onConfirm={() =>
        chosen === null
          ? undefined
          : updateRoleAction({ data: { memberId: member.id, role: chosen } })
      }
    >
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
    </ConfirmationDialog>
  )
}

export function ChangeRoleDialog(props: Props) {
  const { member } = props
  // One confirmation per member: it mounts when the route names one, so the
  // chosen role starts from that member's own.
  return member ? (
    <ChangeRoleConfirmation key={member.id} {...props} member={member} />
  ) : null
}
