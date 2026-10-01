// The folded Properties as the page reads them. The server renders before
// storage is readable, so the first render has every Property open and the
// browser's own list follows (the same rule as the overview's window).
import { useSyncExternalStore } from 'react'
import {
  readCollapsedProperties,
  subscribeCollapsedProperties,
  toggleCollapsedProperty,
} from './collapsed-properties-store'

const NONE: readonly string[] = []

export function useCollapsedProperties() {
  const collapsed = useSyncExternalStore(
    subscribeCollapsedProperties,
    readCollapsedProperties,
    () => NONE,
  )
  return { collapsed, toggle: toggleCollapsedProperty } as const
}
