import { z } from 'zod/v4'
import { useForm } from '@tanstack/react-form'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { FormTextField } from '#/components/forms/form-text-field'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogCancel,
  DialogFooter,
} from '#/components/ui/dialog'
import { useStaffFunctions } from './staff-account-functions'
import { useStaffAccounts } from './staff-accounts-context'
import type { StaffMember } from './staff-account-view'
const nameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a name.')
    .max(100, 'Use up to 100 characters.'),
})

export function StaffRenameDialog({
  member,
  onClose,
}: Readonly<{ member: StaffMember; onClose: () => void }>) {
  const accounts = useStaffAccounts()
  const { renameStaffMember } = useStaffFunctions()
  const rename = useActionMutation(renameStaffMember, {
    onSuccess: async () => {
      await accounts?.refresh()
      onClose()
    },
  })
  const form = useForm({
    defaultValues: { displayName: member.displayName },
    validators: { onSubmit: nameSchema },
    onSubmit: async ({ value }) => {
      await rename({
        data: {
          participationId: member.participationId,
          displayName: value.displayName.trim(),
        },
      })
    },
  })
  return (
    <Dialog
      open
      busy={rename.isPending}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Rename {member.displayName}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submitHandler(form)}>
          <form.Field name="displayName">
            {(field) => (
              <FormTextField
                field={field}
                id="staff-rename"
                label="Name"
                maxLength={100}
                disabled={rename.isPending}
              />
            )}
          </form.Field>
          <DialogErrorBanner error={rename.error} />
          <DialogFooter>
            <DialogCancel />
            <Button type="submit" pending={rename.isPending} pendingLabel="Renaming…">
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
