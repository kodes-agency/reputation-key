// Wires one TanStack Form into the portal's autosave.
//
//   const form = useForm({ ..., listeners: usePortalFormAutosave('welcome', values) })
//
// Every change schedules one debounced write of the whole form through the
// coordinator (which runs it after the other forms' writes, never beside them).
// The form still owns its schema and its `onSubmit`; autosave only decides WHEN
// `handleSubmit` runs.
//
// Fields named in `blurOnly` are not written while they are being typed in: the
// write waits for the field to lose focus. The URL slug is the case — a
// half-typed address would otherwise be saved, and a saved slug unlinks
// hand-typed URLs.

import { useEffect, useMemo, useState } from 'react'
import { usePortalDraftAutosave } from './portal-draft-autosave-context'
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

export function usePortalFormAutosave(
  key: string,
  initialValues: unknown,
  blurOnly: ReadonlyArray<string> = NO_BLUR_ONLY_FIELDS,
) {
  const autosave = usePortalDraftAutosave()
  const [tracker] = useState(() => createDraftFormSaveTracker(initialValues))

  return useMemo(() => {
    const schedule = (form: DraftFormApi) =>
      autosave.schedule(key, () => saveDraftForm(form, tracker))
    return {
      onChange: ({ formApi, fieldApi }: FieldEvent) => {
        if (!blurOnly.includes(fieldApi.name)) schedule(formApi)
      },
      onBlur: ({ formApi, fieldApi }: FieldEvent) => {
        if (blurOnly.includes(fieldApi.name)) schedule(formApi)
      },
    }
  }, [autosave, key, tracker, blurOnly])
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
