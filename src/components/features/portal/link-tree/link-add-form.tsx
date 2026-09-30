// Adding a tile: its label and where it opens. Both are needed to make one; the
// texts for other languages, the line under the label and the icon come once
// the tile exists and is open for editing.

import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import { FieldGroup } from '#/components/ui/field'
import { createLinkInputSchema } from '#/contexts/portal/application/dto/portal-link.dto'
import type { LinktreeMutations } from './use-linktree-mutations'

const addLinkFormSchema = createLinkInputSchema
  .pick({ label: true, url: true })
  .required()

type Props = Readonly<{
  portalId: string
  create: LinktreeMutations['createLink']
  /** The new tile's id, so the section can open it. */
  onAdded: (linkId: string) => void
  onCancel: () => void
}>

export function LinkAddForm({ portalId, create, onAdded, onCancel }: Props) {
  const form = useForm({
    defaultValues: { label: '', url: '' },
    validators: { onSubmit: addLinkFormSchema },
    onSubmit: async ({ value }) => {
      const { link } = await create({
        data: { portalId, label: value.label, url: value.url },
      })
      form.reset()
      onAdded(link.id)
    },
  })

  return (
    <form
      onSubmit={submitHandler(form)}
      className="space-y-4 rounded-lg border border-dashed p-4"
    >
      <FieldGroup className="gap-4">
        <form.Field name="label">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Label"
              id="linktree-add-label"
              maxLength={100}
            />
          )}
        </form.Field>
        <form.Field name="url">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Opens"
              id="linktree-add-url"
              type="url"
              autoComplete="off"
              placeholder="https://"
              maxLength={500}
            />
          )}
        </form.Field>
      </FieldGroup>
      <FormErrorBanner error={create.error} />
      <div className="flex gap-2">
        <SubmitButton mutation={create} form={form}>
          Add link
        </SubmitButton>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
