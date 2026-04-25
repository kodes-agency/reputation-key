// Invite member form — used in the members page dialog
// Per architecture: receives mutation as prop, uses Zod schema for validation.
// The `allowedRoles` prop controls which roles appear in the dropdown.
// The server still validates — this is UI-level gating for UX, not security.

import { useForm } from '@tanstack/react-form'
import { Field, FieldGroup, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { inviteMemberInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { UseMutationResult } from '@tanstack/react-query'
import type { Role } from '#/shared/domain/roles'

type InviteVariables = {
  email: string
  role: 'AccountAdmin' | 'PropertyManager' | 'Staff'
}

type Props = Readonly<{
  mutation: UseMutationResult<unknown, unknown, InviteVariables, unknown>
  allowedRoles: ReadonlyArray<Role>
}>

export function InviteMemberForm({ mutation, allowedRoles }: Props) {
  const form = useForm({
    defaultValues: {
      email: '',
      role: (allowedRoles[0] ?? 'Staff') as Role,
    } satisfies InviteVariables,
    validators: {
      onSubmit: inviteMemberInputSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value)
    },
  })

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
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                <Input
                  id="invite-email"
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="colleague@example.com"
                  autoComplete="email"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
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
