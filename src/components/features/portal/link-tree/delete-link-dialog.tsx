// Confirmation before a tile is deleted. Controlled, because it is opened from
// the tile's menu rather than from a trigger of its own.

import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  /** Resolves when the link is gone; a rejection is shown in the dialog. */
  onDelete: () => Promise<unknown>
}>

export function DeleteLinkDialog({ open, onOpenChange, label, onDelete }: Props) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="destructive"
      title="Delete this link?"
      description={`“${label}” and its texts in every language are removed from the draft. It stays on the live page until you publish.`}
      cancelLabel="Cancel"
      confirmLabel="Delete link"
      onConfirm={onDelete}
    />
  )
}
