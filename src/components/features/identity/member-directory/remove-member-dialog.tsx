import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'

/**
 * Its own "Remove" button opens it (the Manage access sheet), or a caller that
 * owns the state does (the Members row menu: a dialog inside a menu item closes
 * with the menu).
 */
type Opening =
  | Readonly<{ open?: undefined; onOpenChange?: undefined }>
  | Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>

type Props = Opening &
  Readonly<{
    memberName: string
    memberEmail: string
    /** Rejects with the refusal, which the confirmation says in place. */
    onRemove: () => Promise<unknown>
  }>

export function RemoveMemberDialog({
  memberName,
  memberEmail,
  onRemove,
  open,
  onOpenChange,
}: Props) {
  const body = {
    tone: 'destructive',
    title: `Remove ${memberName}?`,
    description: `This will remove ${memberName} (${memberEmail}) from your organization. They will lose access to the organization and its properties.`,
    cancelLabel: 'Cancel',
    confirmLabel: 'Remove member',
    pendingLabel: 'Removing…',
    onConfirm: onRemove,
  } as const
  if (open !== undefined && onOpenChange) {
    return <ConfirmationDialog open={open} onOpenChange={onOpenChange} {...body} />
  }
  return (
    <ConfirmationDialog
      trigger={
        <ConfirmationTrigger tone="destructive" size="sm">
          Remove
        </ConfirmationTrigger>
      }
      {...body}
    />
  )
}
