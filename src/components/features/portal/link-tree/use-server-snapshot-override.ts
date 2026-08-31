import { useState } from 'react'

type Update<T> = T | ((previous: T) => T)

export function useServerSnapshotOverride<T>(source: T) {
  const [override, setOverride] = useState<{
    source: T
    value: T
  } | null>(null)
  const value = override?.source === source ? override.value : source
  const setValue = (next: Update<T>) => {
    setOverride((current) => {
      const previous = current?.source === source ? current.value : source
      return {
        source,
        value: typeof next === 'function' ? (next as (previous: T) => T)(previous) : next,
      }
    })
  }
  return [value, setValue] as const
}
