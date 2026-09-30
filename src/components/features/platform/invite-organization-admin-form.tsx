// Invite an Account Admin to an Organization that has none (ADR 0063).
//
// One small inline form per Organization row, so it keeps its own pending and
// error state (`useAction` over the shared Action): a refusal for one
// Organization never shows on another's row. The route's Action reports the
// outcome by toast; this form clears its field on success and shows a refusal
// beside the field it came from.

import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { submitForm } from '#/components/forms/form-submit'
import { useAction, type Action } from '#/components/hooks/use-action'
import {
  inviteOrganizationAdminInputSchema,
  type InviteOrganizationAdminInput,
  type InviteOrganizationAdminResult,
} from '#/contexts/identity/application/dto/platform-console.dto'

const inviteFormSchema = inviteOrganizationAdminInputSchema.pick({ email: true })

type Props = Readonly<{
  organizationId: string
  organizationName: string
  inviteAdmin: Action<
    { data: InviteOrganizationAdminInput },
    InviteOrganizationAdminResult
  >
}>

export function InviteOrganizationAdminForm({
  organizationId,
  organizationName,
  inviteAdmin,
}: Props) {
  const invite = useAction(inviteAdmin)
  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: inviteFormSchema },
    onSubmit: async ({ value, formApi }) => {
      await invite({ data: { organizationId, email: value.email } })
      formApi.reset()
    },
  })

  return (
    <form
      aria-label={`Invite an Account Admin to ${organizationName}`}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void submitForm(form)
      }}
      className="flex flex-col gap-3 sm:max-w-sm"
    >
      <FormErrorBanner error={invite.error} />
      <FieldGroup>
        <form.Field name="email">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Account Admin's email"
              id={`invite-admin-email-${organizationId}`}
              type="email"
              placeholder="admin@example.com"
              autoComplete="off"
            />
          )}
        </form.Field>
      </FieldGroup>
      <SubmitButton
        mutation={invite}
        form={form}
        variant="outline"
        className="self-start"
      >
        Send invitation
      </SubmitButton>
    </form>
  )
}
