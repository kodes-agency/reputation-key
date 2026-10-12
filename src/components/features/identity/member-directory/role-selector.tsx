// The invite form's Role field: a labelled RoleChoice bound to a form field.

import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { RoleChoice } from './role-choice'

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

const LABEL_ID = 'invite-role-label'

export function RoleSelector({ field, allowedRoles }: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel id={LABEL_ID}>Role</FieldLabel>
      <RoleChoice
        value={field.state.value}
        onValueChange={field.handleChange}
        allowedRoles={allowedRoles}
        idPrefix="invite-role"
        aria-labelledby={LABEL_ID}
        aria-invalid={isInvalid}
      />
      {isInvalid && (
        <FieldError
          errors={field.state.meta.errors as Array<{ message?: string } | undefined>}
        />
      )}
    </Field>
  )
}
