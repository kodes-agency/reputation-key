import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { roleLabel } from '#/components/features/identity/shared/role-utils'

type Props = Readonly<{
  field: {
    state: {
      value: BetaInteractiveRole
      meta: {
        isTouched: boolean
        isValid: boolean
        errors: unknown
      }
    }
    handleChange: (value: BetaInteractiveRole) => void
  }
  allowedRoles: ReadonlyArray<BetaInteractiveRole>
}>

export function RoleSelector({ field, allowedRoles }: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel>Role</FieldLabel>
      <Select
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value as BetaInteractiveRole)}
      >
        <SelectTrigger aria-invalid={isInvalid} aria-label="Role">
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
