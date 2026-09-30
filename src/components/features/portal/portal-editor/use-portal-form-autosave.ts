// Wires one TanStack Form into the portal's autosave.
//
//   const { listeners, effective } = usePortalFormAutosave('welcome', values)
//   const form = useForm({ ..., listeners, onSubmit: ({ value }) => write(effective(value)) })
//
// Every change schedules one debounced write of the whole form through the
// coordinator (which runs it after the other forms' writes, never beside them).
// The form still owns its schema and its `onSubmit`; autosave only decides WHEN
// `handleSubmit` runs.
//
// Fields named in `blurOnly` are committed when they lose focus, not while they
// are typed in (portal-draft-blur-fields.ts): the URL slug is the case — a
// half-typed address would otherwise be saved, and a saved slug unlinks
// hand-typed URLs. Every write of the form sends all of its fields, so
// `onSubmit` must send `effective(value)`, which puts each such field at its
// last committed value. A field with something typed and not yet committed
// counts as unsaved, so leaving the editor asks first.

import { useEffect, useMemo, useState } from 'react'
import { usePortalDraftAutosave } from './portal-draft-autosave-context'
import { createBlurCommittedFields } from './portal-draft-blur-fields'
import {
  createDraftFormSaveTracker,
  saveDraftForm,
  type DraftFormApi,
} from './portal-draft-form-save'

type FieldEvent = Readonly<{
  formApi: DraftFormApi
  fieldApi: Readonly<{ name: string }>
}>

const NO_BLUR_ONLY_FIELDS: ReadonlyArray<string> = []

const valueOf = ({ formApi, fieldApi }: FieldEvent): unknown =>
  (formApi.state.values as Readonly<Record<string, unknown>>)[fieldApi.name]

export function usePortalFormAutosave<T extends Readonly<Record<string, unknown>>>(
  key: string,
  initialValues: T,
  blurOnly: ReadonlyArray<string> = NO_BLUR_ONLY_FIELDS,
) {
  const autosave = usePortalDraftAutosave()
  const [tracker] = useState(() => createDraftFormSaveTracker(initialValues))
  const [fields] = useState(() => createBlurCommittedFields(blurOnly, initialValues))

  useEffect(
    () => autosave.guardExplicit(`${key}-uncommitted`, fields.hasUncommitted),
    [autosave, key, fields],
  )

  return useMemo(() => {
    const schedule = (form: DraftFormApi) =>
      autosave.schedule(key, () =>
        saveDraftForm(form, tracker, (values) => fields.apply(values as object)),
      )
    return {
      listeners: {
        onChange: (event: FieldEvent) => {
          const { name } = event.fieldApi
          if (!blurOnly.includes(name)) return schedule(event.formApi)
          fields.type(name, valueOf(event))
        },
        onBlur: (event: FieldEvent) => {
          const { name } = event.fieldApi
          if (!blurOnly.includes(name)) return
          fields.commit(name, valueOf(event))
          schedule(event.formApi)
        },
      },
      /** The values to write: blur-committed fields at their committed value. */
      effective: fields.apply,
    }
  }, [autosave, key, tracker, fields, blurOnly])
}

/**
 * Register a form that keeps an explicit Save (a property-wide field) so that
 * leaving the editor with edits in it asks first. The form must remount when
 * the saved values change, as these forms do, so a saved form reads clean.
 */
export function useExplicitDraftGuard(
  key: string,
  form: Readonly<{ state: Readonly<{ isDefaultValue: boolean }> }>,
) {
  const autosave = usePortalDraftAutosave()
  useEffect(
    () => autosave.guardExplicit(key, () => !form.state.isDefaultValue),
    [autosave, key, form],
  )
}
