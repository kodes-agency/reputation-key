// Wires one TanStack Form into the portal's autosave.
//
//   const { listeners } = usePortalFormAutosave('welcome', values)
//   const form = useForm({ ..., listeners, onSubmit: ({ value }) => write(value) })
//
// Every change schedules one debounced write of the whole form through the
// coordinator (which runs it after the other forms' writes, never beside them).
// The form still owns its schema and its `onSubmit`; autosave only decides WHEN
// `handleSubmit` runs.

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePortalDraftAutosave } from './portal-draft-autosave-context'
import {
  createDraftFormSaveTracker,
  saveDraftForm,
  type DraftFormApi,
} from './portal-draft-form-save'

type FieldEvent = Readonly<{ formApi: DraftFormApi }>

export function usePortalFormAutosave<T extends Readonly<Record<string, unknown>>>(
  key: string,
  initialValues: T,
) {
  const autosave = usePortalDraftAutosave()
  const [tracker] = useState(() => createDraftFormSaveTracker(initialValues))

  return useMemo(
    () => ({
      listeners: {
        onChange: ({ formApi }: FieldEvent) =>
          autosave.schedule(key, () => saveDraftForm(formApi, tracker)),
      },
    }),
    [autosave, key, tracker],
  )
}

/**
 * Register edits that keep an explicit Save and live outside a TanStack Form
 * (the responsible managers' ticks), so leaving the editor with them asks
 * first. `isDirty` is read when a navigation asks, so it may read a ref; the
 * registration ends when the caller unmounts.
 */
export function useExplicitDirtyGuard(key: string, isDirty: () => boolean) {
  const autosave = usePortalDraftAutosave()
  const latest = useRef(isDirty)
  useEffect(() => {
    latest.current = isDirty
  })
  useEffect(() => autosave.guardExplicit(key, () => latest.current()), [autosave, key])
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
