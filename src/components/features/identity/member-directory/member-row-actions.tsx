// A member's actions: one "more actions" menu, like every other list row (UI
// consistency scan: COLL-02, ACT-06). Change role and Edit access open what the
// route holds (the dialog and the sheet, outside the table), so their items only
// report the choice. Removing cannot be taken back, so it is the destructive item
// and asks first, in a dialog held here outside the menu (a dialog inside a menu
// item closes with the menu). The dialog stays open and says a refusal in place,
// so that Action's rejection goes to the dialog.
import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { RemoveMemberDialog } from './remove-member-dialog'

type Props = Readonly<{
  memberId: string
  name: string
  email: string
  /** Null where the viewer may not change roles. */
  onChangeRole: (() => void) | null
  /** Null where the member holds no Property scope or the viewer may not edit it. */
  onEditAccess: (() => void) | null
  /** Null where the viewer may not remove members. */
  removeMemberAction: Action<{ data: { memberId: string } }> | null
}>

export function MemberRowActions({
  memberId,
  name,
  email,
  onChangeRole,
  onEditAccess,
  removeMemberAction,
}: Props) {
  const [removing, setRemoving] = useState(false)
  const hasChanges = onChangeRole !== null || onEditAccess !== null
  return (
    <>
      <RowActionsMenu name={name}>
        {onChangeRole ? (
          <RowActionsItem opensDialog onSelect={onChangeRole}>
            Change role
          </RowActionsItem>
        ) : null}
        {onEditAccess ? (
          <RowActionsItem opensDialog onSelect={onEditAccess}>
            Edit access
          </RowActionsItem>
        ) : null}
        {hasChanges && removeMemberAction ? <RowActionsSeparator /> : null}
        {removeMemberAction ? (
          <RowActionsItem destructive opensDialog onSelect={() => setRemoving(true)}>
            Remove member
          </RowActionsItem>
        ) : null}
      </RowActionsMenu>
      {removeMemberAction ? (
        <RemoveMemberDialog
          open={removing}
          onOpenChange={setRemoving}
          memberName={name}
          memberEmail={email}
          onRemove={() => removeMemberAction({ data: { memberId } })}
        />
      ) : null}
    </>
  )
}
