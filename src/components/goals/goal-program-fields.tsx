// The form fields every Goal Program change asks for: which subjects the goal
// covers, and a note on the change for whoever wants to leave one. Each takes
// the `field` its `form.Field` renders.

import { useId, type ComponentProps } from 'react'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { Field, FieldError } from '#/components/ui/field'
import { FormTextarea, type BaseFieldApiTextarea } from '#/components/forms/form-textarea'
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

/**
 * The note on a change. A change needs no reason: without a note the version
 * records what kind of change it was.
 */
export function GoalChangeReasonField({
  field,
  id,
}: Readonly<{ field: BaseFieldApiTextarea; id: string }>) {
  return <FormTextarea field={field} id={id} label="Note" optional maxLength={500} />
}
