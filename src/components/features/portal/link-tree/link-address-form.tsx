// Where a tile opens. The address is checked on the server (it must be https,
// reachable and approved), so it is saved when the field is left or Enter is
// pressed, not while it is typed, and a refusal is shown right under it.

import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { updateLinkInputSchema } from '#/contexts/portal/application/dto/portal-link.dto'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import type { LinktreeMutations } from './use-linktree-mutations'

const addressFormSchema = updateLinkInputSchema.pick({ url: true }).required()

type Props = Readonly<{
  link: PortalLinktreeLink
  update: LinktreeMutations['updateLink']
  /** The refusal of the last attempt on THIS tile, if any. */
  error: unknown
  onEdit: () => void
  disabled: boolean
}>

export function LinkAddressForm({ link, update, error, onEdit, disabled }: Props) {
  const form = useForm({
    defaultValues: { url: link.url },
    listeners: {
      onChange: onEdit,
      onBlur: ({ formApi }) => {
        if (formApi.state.values.url.trim() === link.url) return
        void formApi.handleSubmit().catch(() => undefined)
      },
    },
    validators: { onSubmit: addressFormSchema },
    onSubmit: async ({ value }) => {
      await update({ data: { linkId: link.id, url: value.url } })
    },
  })

  return (
    <form onSubmit={submitHandler(form)} className="space-y-2">
      <form.Field name="url">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Opens"
            id={`link-${link.id}-url`}
            type="url"
            autoComplete="off"
            placeholder="https://"
            maxLength={500}
            disabled={disabled}
          />
        )}
      </form.Field>
      <FormErrorBanner error={error} />
    </form>
  )
}
