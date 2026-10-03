import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'

type Props = Readonly<{
  memberName: string
  memberEmail: string
  /** Rejects with the refusal, which the confirmation says in place. */
  onRemove: () => Promise<unknown>
}>

export function RemoveMemberDialog({ memberName, memberEmail, onRemove }: Props) {
  return (
    <ConfirmationDialog
      trigger={
        <ConfirmationTrigger tone="destructive" size="sm">
          Remove
        </ConfirmationTrigger>
      }
      tone="destructive"
      title={`Remove ${memberName}?`}
      description={`This will remove ${memberName} (${memberEmail}) from your organization. They will lose access to the organization and its properties.`}
      cancelLabel="Cancel"
      confirmLabel="Remove member"
      pendingLabel="Removing…"
      onConfirm={onRemove}
    />
  )
}
