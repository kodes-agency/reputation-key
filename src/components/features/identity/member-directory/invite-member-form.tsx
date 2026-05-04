// Invite member form — used in the members page dialog
// Per architecture: receives mutation as prop, uses Zod schema for validation.
// The `allowedRoles` prop controls which roles appear in the dropdown.
// The `properties` prop provides properties for the assignment multi-select.
// The server still validates — this is UI-level gating for UX, not security.

import { useForm } from '@tanstack/react-form'
import { Field, FieldGroup, FieldLabel, FieldError } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Badge } from '#/components/ui/badge'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { inviteMemberInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { Role } from '#/shared/domain/roles'
import { X } from 'lucide-react'
import { z } from 'zod/v4'

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

  const toggleProperty = (propertyId: string) => {
    const current = form.getFieldValue('propertyIds') as string[]
    const next = current.includes(propertyId)
      ? current.filter((id) => id !== propertyId)
      : [...current, propertyId]
    form.setFieldValue('propertyIds', next)
  }

  const removeProperty = (propertyId: string) => {
    const current = form.getFieldValue('propertyIds') as string[]
    form.setFieldValue(
      'propertyIds',
      current.filter((id) => id !== propertyId),
    )
  }

  const selectedIds = form.getFieldValue('propertyIds') as string[]
  const availableProperties = properties.filter((p) => !selectedIds.includes(p.id))

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
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel>Role</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as Role)}
                >
                  <SelectTrigger aria-invalid={isInvalid}>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {allowedRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="propertyIds">
          {() => (
            <Field>
              <FieldLabel>Assign to properties (optional)</FieldLabel>

              {/* Selected properties as removable badges */}
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedIds.map((pid) => {
                    const prop = properties.find((p) => p.id === pid)
                    return (
                      <Badge key={pid} variant="secondary" className="gap-1 pr-1">
                        {prop?.name ?? pid}
                        <button
                          type="button"
                          onClick={() => removeProperty(pid)}
                          className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                          aria-label={`Remove ${prop?.name ?? pid}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              )}

              {/* Add property dropdown */}
              {availableProperties.length > 0 && (
                <Select onValueChange={toggleProperty}>
                  <SelectTrigger>
                    <SelectValue placeholder="Add a property…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {availableProperties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}

              {properties.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No properties yet. The member can be assigned later.
                </p>
              )}
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Send Invitation
      </SubmitButton>
    </form>
  )
}

function roleLabel(role: Role): string {
  switch (role) {
    case 'AccountAdmin':
      return 'Account Admin'
    case 'PropertyManager':
      return 'Property Manager'
    case 'Staff':
      return 'Staff'
  }
}
