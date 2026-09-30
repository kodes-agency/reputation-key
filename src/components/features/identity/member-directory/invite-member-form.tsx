// Invite member form — used in the members page dialog
// Per architecture: receives mutation as prop, uses Zod schema for validation.
// The `allowedRoles` prop controls which roles are offered; the invitation
// starts as a Property Manager, the least privilege. The `properties` prop
// feeds the property picker, which only a Property Manager needs: an Account
// Admin sees every property.
// The server still validates — this is UI-level gating for UX, not security.

import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { inviteMemberInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { isGrantScopedRole } from '#/shared/domain/beta-interactive-role'
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
  role: BetaInteractiveRole
  propertyIds: string[]
}

import type { AnyAction } from '#/components/hooks/use-action'

type Props = Readonly<{
  mutation: AnyAction
  allowedRoles: ReadonlyArray<BetaInteractiveRole>
  properties: ReadonlyArray<PropertyOption>
}>

/** Least privilege first: an invitation is a Property Manager's unless chosen otherwise. */
function defaultRole(
  allowedRoles: ReadonlyArray<BetaInteractiveRole>,
): BetaInteractiveRole {
  return allowedRoles.includes('PropertyManager')
    ? 'PropertyManager'
    : (allowedRoles[0] ?? 'PropertyManager')
}

export function InviteMemberForm({ mutation, allowedRoles, properties }: Props) {
  const form = useForm({
    defaultValues: {
      email: '',
      role: defaultRole(allowedRoles),
      propertyIds: [] as string[],
    } satisfies InviteVariables,
    validators: {
      onSubmit: inviteFormSchema,
    },
    onSubmit: async ({ value }) => {
      // An Account Admin reaches every property, so no grants are sent for one.
      await mutation({
        data: isGrantScopedRole(value.role) ? value : { ...value, propertyIds: [] },
      })
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
        void submitForm(form)
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

        <form.Subscribe selector={(state) => state.values.role}>
          {(role) =>
            isGrantScopedRole(role) ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">
                Account Admins can access every property.
              </p>
            )
          }
        </form.Subscribe>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Send invitation
      </SubmitButton>
    </form>
  )
}
