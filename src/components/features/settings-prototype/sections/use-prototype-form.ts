// PROTOTYPE — a fake form: values live in memory, Save waits half a second and then
// says Saved with the time. Nothing is persisted; switching property remounts the
// section (the registry keys it), which puts the fixture values back.
import { useCallback, useEffect, useRef, useState } from 'react'

type Value = string | number | boolean
export type PrototypeFormStatus = 'idle' | 'saving' | 'saved'

const FAKE_SAVE_MS = 500

const clock = (): string =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export type PrototypeForm<T> = Readonly<{
  value: T
  set: (patch: Partial<T>) => void
  dirty: boolean
  reset: () => void
  save: () => void
  status: PrototypeFormStatus
  /** "Saved 14:02" once saved, until the next edit. */
  savedText: string | null
}>

export function usePrototypeForm<T extends Readonly<Record<string, Value>>>(
  initial: T,
): PrototypeForm<T> {
  const [saved, setSaved] = useState<T>(initial)
  const [value, setValue] = useState<T>(initial)
  const [status, setStatus] = useState<PrototypeFormStatus>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const latest = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    latest.current = value
  }, [value])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const dirty = (Object.keys(value) as Array<keyof T>).some(
    (key) => value[key] !== saved[key],
  )

  const set = useCallback((patch: Partial<T>) => {
    setStatus('idle')
    setValue((previous) => ({ ...previous, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setValue(saved)
  }, [saved])

  const save = useCallback(() => {
    setStatus('saving')
    timer.current = setTimeout(() => {
      setSaved(latest.current)
      setSavedAt(clock())
      setStatus('saved')
    }, FAKE_SAVE_MS)
  }, [])

  return {
    value,
    set,
    dirty,
    reset,
    save,
    status,
    savedText: status === 'saved' && savedAt !== null ? `Saved ${savedAt}` : null,
  }
}
