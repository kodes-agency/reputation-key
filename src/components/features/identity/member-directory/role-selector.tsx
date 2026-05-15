import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { Role } from '#/shared/domain/roles'
import { roleLabel } from '#/components/features/identity/shared/role-utils'

type Props = Readonly<{
  field: {
    state: {
      value: Role
      meta: {
        isTouched: boolean
        isValid: boolean
        errors: unknown
      }
    }
    handleChange: (value: Role) => void
  }
  allowedRoles: ReadonlyArray<Role>
}>

export function RoleSelector({ field, allowedRoles }: Props) {
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
                {roleLabel(r, 'full')}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {isInvalid && (
        <FieldError
          errors={field.state.meta.errors as Array<{ message?: string } | undefined>}
        />
      )}
    </Field>
  )
}
