// Adding a tile: its label and where it opens. Both are needed to make one; the
// texts for other languages, the line under the label and the icon come once
// the tile exists and is open for editing.

import { useForm } from '@tanstack/react-form'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import { FieldGroup } from '#/components/ui/field'
import { createLinkInputSchema } from '#/contexts/portal/application/dto/portal-link.dto'
import { LINK_TEXT_LABEL_MAX_LENGTH } from '#/contexts/portal/application/dto/portal-linktree.dto'
import type { LinktreeMutations } from './use-linktree-mutations'

const addLinkFormSchema = createLinkInputSchema
  .pick({ label: true, url: true })
  .required()

type Props = Readonly<{
  portalId: string
  create: LinktreeMutations['createLink']
  /**
   * Runs a write after the section's own earlier writes and any typed text still
   * waiting out its debounce, so the add cannot race either.
   */
  enqueue: <T>(write: () => Promise<T>) => Promise<T>
  /** The new tile's id, so the section can open it. */
  onAdded: (linkId: string) => void
  onCancel: () => void
}>

export function LinkAddForm({ portalId, create, enqueue, onAdded, onCancel }: Props) {
  const form = useForm({
    defaultValues: { label: '', url: '' },
    validators: { onSubmit: addLinkFormSchema },
    onSubmit: async ({ value }) => {
      const { link } = await enqueue(() =>
        create({ data: { portalId, label: value.label, url: value.url } }),
      )
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
              maxLength={LINK_TEXT_LABEL_MAX_LENGTH}
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
      {/* An add is a bounded task: it keeps its Cancel, before the primary, and has
          nothing saved to put back. */}
      <FormActions error={create.error}>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton mutation={create} form={form}>
          Add link
        </SubmitButton>
      </FormActions>
    </form>
  )
}
