// The form fields every Goal Program change asks for: which subjects the goal
// covers, and why it changes. Each takes the `field` its `form.Field` renders.

import { useId, type ComponentProps } from 'react'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { Field, FieldError } from '#/components/ui/field'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
  type GoalSubjectKey,
} from './goal-subject-picker'

type FieldMeta = Readonly<{
  isValid: boolean
  errors: Array<{ message?: string } | undefined>
}>

type SubjectsFieldApi = Readonly<{
  state: Readonly<{ value: readonly GoalSubject[]; meta: FieldMeta }>
  handleChange: (subjects: GoalSubject[]) => void
}>

export function GoalSubjectsField({
  field,
  property,
  groups,
  portals,
}: Pick<ComponentProps<typeof GoalSubjectPicker>, 'property' | 'groups' | 'portals'> &
  Readonly<{ field: SubjectsFieldApi }>) {
  const labelId = useId()
  return (
    <Field data-invalid={!field.state.meta.isValid} aria-labelledby={labelId}>
      {/* The group's name: the rule under it is help for these choices, not for the field above. */}
      <span id={labelId} className="text-sm leading-none font-medium">
        Subjects
      </span>
      <GoalSubjectPicker
        property={property}
        groups={groups}
        portals={portals}
        selected={field.state.value.map(goalSubjectKey)}
        onChange={(keys: GoalSubjectKey[]) =>
          field.handleChange(goalSubjectsFromKeys(keys))
        }
      />
      <FieldError errors={field.state.meta.errors} />
    </Field>
  )
}

export function GoalChangeReasonField({
  field,
  id,
}: Readonly<{ field: BaseFieldApi; id: string }>) {
  return (
    <FormTextField field={field} id={id} label="Reason for the change" maxLength={500} />
  )
}
