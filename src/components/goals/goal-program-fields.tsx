// The form fields every Goal Program change asks for: which subjects the goal
// covers, and why it changes. Each takes the `field` its `form.Field` renders.

import type { ComponentProps } from 'react'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
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

type ReasonFieldApi = Readonly<{
  state: Readonly<{ value: string; meta: FieldMeta }>
  handleBlur: () => void
  handleChange: (reason: string) => void
}>

export function GoalSubjectsField({
  field,
  property,
  groups,
  portals,
}: Pick<ComponentProps<typeof GoalSubjectPicker>, 'property' | 'groups' | 'portals'> &
  Readonly<{ field: SubjectsFieldApi }>) {
  return (
    <Field data-invalid={!field.state.meta.isValid}>
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
}: Readonly<{ field: ReasonFieldApi; id: string }>) {
  return (
    <Field data-invalid={!field.state.meta.isValid}>
      <FieldLabel htmlFor={id}>Reason for the change</FieldLabel>
      <Input
        id={id}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={!field.state.meta.isValid}
        maxLength={500}
      />
      <FieldError errors={field.state.meta.errors} />
    </Field>
  )
}
