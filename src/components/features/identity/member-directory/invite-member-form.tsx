// Invite member form — used in the members page dialog
// Per architecture: receives mutation as prop, uses Zod schema for validation.
// The `allowedRoles` prop controls which roles appear in the dropdown.
// The `properties` prop provides properties for the assignment multi-select.
// The server still validates — this is UI-level gating for UX, not security.

import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { inviteMemberInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { Role } from '#/shared/domain/roles'
import { z } from 'zod/v4'
import { RoleSelector } from './role-selector'
import { PropertyAssignmentSelector } from './property-assignment-selector'

// Form-specific schema: propertyIds is required (not optional) in the form
// since we always provide [] as default. Derives from DTO to inherit rules.
const inviteFormSchema = inviteMemberInputSchema.extend({
  propertyIds: z.array(z.string().min(1)),
})

type PropertyOption = Readonly<{
  id: string
  name: string
}>

type InviteVariables = {
  email: string
  role: 'AccountAdmin' | 'PropertyManager' | 'Staff'
  propertyIds: string[]
}

import type { AnyAction } from '#/components/hooks/use-action'

type Props = Readonly<{
  mutation: AnyAction
  allowedRoles: ReadonlyArray<Role>
  properties: ReadonlyArray<PropertyOption>
}>

export function InviteMemberForm({ mutation, allowedRoles, properties }: Props) {
  const form = useForm({
    defaultValues: {
      email: '',
      role: (allowedRoles[0] ?? 'Staff') as Role,
      propertyIds: [] as string[],
    } satisfies InviteVariables,
    validators: {
      onSubmit: inviteFormSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation(value)
    },
  })

  /** TanStack Form's getFieldValue returns unknown; defaultValues types propertyIds as string[] */
  const getPropertyIds = (): string[] => {
    const raw = form.getFieldValue('propertyIds')
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  }

  const toggleProperty = (propertyId: string) => {
    const current = getPropertyIds()
    const next = current.includes(propertyId)
      ? current.filter((id) => id !== propertyId)
      : [...current, propertyId]
    form.setFieldValue('propertyIds', next)
  }

  const removeProperty = (propertyId: string) => {
    const current = getPropertyIds()
    form.setFieldValue(
      'propertyIds',
      current.filter((id) => id !== propertyId),
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="email">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Email address"
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              autoComplete="email"
            />
          )}
        </form.Field>

        <form.Field name="role">
          {(field) => <RoleSelector field={field} allowedRoles={allowedRoles} />}
        </form.Field>

        <form.Field name="propertyIds">
          {(field) => (
            <PropertyAssignmentSelector
              field={field}
              properties={properties}
              onToggleProperty={toggleProperty}
              onRemoveProperty={removeProperty}
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Send Invitation
      </SubmitButton>
    </form>
  )
}
