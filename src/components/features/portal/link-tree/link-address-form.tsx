// Where a tile opens: a website, a phone number or an email address. The
// address is checked on the server (a website must be https, reachable and
// approved; a phone number or an email address only well formed), so it is
// saved when the field is left or Enter is pressed, not while it is typed, and a
// refusal is shown right under it. The check can take seconds: while it runs,
// the line below the field (`status`, the approval of the address) gives way to
// "Checking address…", because the approval it would show still belongs to the
// previous address.

import type { ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitForm, submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { updateLinkInputSchema } from '#/contexts/portal/application/dto/portal-link.dto'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import {
  isSavedLinkAddress,
  LINK_ADDRESS_FIELD,
  linkAddressForField,
} from './link-address-field'
import { LinktreeCheckingLine } from './linktree-checking-line'
import type { LinktreeMutations } from './use-linktree-mutations'

const addressFormSchema = updateLinkInputSchema.pick({ url: true }).required()

type Props = Readonly<{
  link: PortalLinktreeLink
  update: LinktreeMutations['updateLink']
  /** The refusal of the last attempt on THIS tile, if any. */
  error: unknown
  onEdit: () => void
  disabled: boolean
  /** The line under the field: the approval of the saved address. */
  status: ReactNode
}>

export function LinkAddressForm({
  link,
  update,
  error,
  onEdit,
  disabled,
  status,
}: Props) {
  const form = useForm({
    defaultValues: { url: linkAddressForField(link.url) },
    listeners: {
      onChange: onEdit,
      onBlur: ({ formApi }) => {
        if (isSavedLinkAddress(formApi.state.values.url, link.url)) return
        void submitForm(formApi)
      },
    },
    validators: { onSubmit: addressFormSchema },
    onSubmit: async ({ value }) => {
      await update({ data: { linkId: link.id, url: value.url } })
    },
  })

  return (
    <>
      <form onSubmit={submitHandler(form)} className="space-y-2">
        <form.Field name="url">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label={LINK_ADDRESS_FIELD.label}
              description={LINK_ADDRESS_FIELD.description}
              id={`link-${link.id}-url`}
              autoComplete="off"
              maxLength={500}
              disabled={disabled}
            />
          )}
        </form.Field>
        <FormErrorBanner error={error} />
      </form>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (isSubmitting ? <LinktreeCheckingLine /> : status)}
      </form.Subscribe>
    </>
  )
}
