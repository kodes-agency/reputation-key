// The contact-request switch: whether this Portal offers guests a way to share
// an email address after private feedback. Saves through the editor's autosave.

import { useForm } from '@tanstack/react-form'
import type { z } from 'zod/v4'
import { updatePortalSettingsInputSchema } from '#/contexts/portal/publication/portal-intents.contracts'
import type { Action } from '#/components/hooks/use-action'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { usePortalFormAutosave } from './use-portal-form-autosave'
import type {
  PortalData,
  UpdatePortalVariables,
} from '#/contexts/portal/workspace/ui/shared/types'

const contactRequestsFormSchema = updatePortalSettingsInputSchema
  .pick({ contactRequestsEnabled: true })
  .required()
type FormValues = z.infer<typeof contactRequestsFormSchema>

const CONTACT_REQUESTS_LABEL = 'Let guests ask to be contacted'
const CONTACT_REQUESTS_HELP =
  'Guests who leave private feedback can share an email address, if they like, so a manager can follow up. Only managers who can see the feedback can read it.'
const CONTACT_REQUESTS_NOT_YET =
  'Contact requests are not available yet. This takes effect once they are.'

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  /** A Privacy Notice version covering contact requests is in force. */
  noticeInForce: boolean
  disabled?: boolean
}>

export function PortalContactRequestsForm({
  portal,
  mutation,
  noticeInForce,
  disabled = false,
}: Props) {
  const defaults = {
    contactRequestsEnabled: portal.contactRequestsEnabled,
  } satisfies FormValues
  const autosave = usePortalFormAutosave('contact-requests', defaults)

  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: contactRequestsFormSchema },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          portalId: portal.id,
          contactRequestsEnabled: value.contactRequestsEnabled,
        },
      })
    },
  })

  return (
    <form
      data-reload-safe
      className="flex flex-col gap-6"
      onSubmit={(event) => event.preventDefault()}
    >
      <form.Field name="contactRequestsEnabled">
        {(field) => (
          <SettingSwitchRow
            id="edit-contact-requests"
            label={CONTACT_REQUESTS_LABEL}
            description={CONTACT_REQUESTS_HELP}
            {...(noticeInForce ? {} : { note: CONTACT_REQUESTS_NOT_YET })}
            checked={field.state.value}
            onCheckedChange={field.handleChange}
            commit="deferred"
            unsaved={field.state.value !== portal.contactRequestsEnabled}
            disabled={disabled}
          />
        )}
      </form.Field>
    </form>
  )
}
