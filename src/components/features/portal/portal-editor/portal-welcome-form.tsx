// The portal's name: what the team reads in lists, menus and the workspace
// header. It is part of the portal's draft, so it saves as it is typed
// (use-portal-form-autosave.ts). What guests read is each language's welcome
// line, below it, and the property's own name in large type; a property that
// has no public name yet shows this name there instead.

import { useForm } from '@tanstack/react-form'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
import type { Action } from '#/components/hooks/use-action'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { usePortalFormAutosave } from './use-portal-form-autosave'
import type { PortalData, UpdatePortalVariables } from '../shared/types'

const nameFormSchema = updatePortalInputSchema.pick({ name: true }).required()

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  /** Shown, never edited: the editor's `canEdit` is false (`portalEditAccess`). */
  readOnly?: boolean
  /** Whether the property has a public name; without one guests read this name in its place. */
  propertyHasName?: boolean
}>

export function PortalWelcomeForm({
  portal,
  mutation,
  readOnly = false,
  propertyHasName = true,
}: Props) {
  const defaults = { name: portal.name }
  const autosave = usePortalFormAutosave('welcome', defaults)

  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: nameFormSchema },
    onSubmit: async ({ value }) => {
      await mutation({ data: { portalId: portal.id, name: value.name } })
    },
  })

  return (
    // The write is the coordinator's, so Enter must not also submit natively.
    <form onSubmit={(event) => event.preventDefault()}>
      <form.Field name="name">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Name"
            id="edit-portal-name"
            maxLength={100}
            readOnly={readOnly}
            description={
              propertyHasName
                ? 'Your team sees it in lists and menus.'
                : 'Your team sees it in lists and menus. Until the property has a public name, guests read it in large type too.'
            }
          />
        )}
      </form.Field>
    </form>
  )
}
