import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FormTextField } from '#/components/forms/form-text-field'
import { submitHandler } from '#/components/forms/form-submit'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'

export function StaffPersonEdit({
  kind,
  value,
  action,
  onCancel,
}: Readonly<{
  kind: 'name' | 'email'
  value: string
  action: Action<string>
  onCancel: () => void
}>) {
  const form = useForm({
    defaultValues: { value },
    validators: {
      onSubmit: z.object({
        value:
          kind === 'email'
            ? z.email('Enter a valid email address.').max(320)
            : z.string().trim().min(1, 'Enter a name.').max(100),
      }),
    },
    onSubmit: async ({ value: input }) => {
      await action(input.value)
      onCancel()
    },
  })
  return (
    <form onSubmit={submitHandler(form)} className="space-y-3">
      <form.Field name="value">
        {(field) => (
          <FormTextField
            field={field}
            id={`staff-change-${kind}`}
            label={kind === 'email' ? 'New email' : 'Name'}
            type={kind === 'email' ? 'email' : 'text'}
            maxLength={kind === 'email' ? 320 : 100}
            disabled={action.isPending}
          />
        )}
      </form.Field>
      <FormErrorBanner error={action.error} />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={action.isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" pending={action.isPending} pendingLabel="Saving…">
          Save changes
        </Button>
      </div>
    </form>
  )
}
