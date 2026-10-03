// The one autosave coordinator of the portal being edited, shared by everything
// under the workspace layout: the forms that register their saves, the header
// that shows the status, and the navigation guard. The layout mounts it keyed by
// portal id, so a coordinator can never carry one portal's edits into another.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  createPortalDraftAutosave,
  type PortalDraftAutosave,
  type PortalDraftAutosaveState,
} from './portal-draft-autosave'

const PortalDraftAutosaveContext = createContext<PortalDraftAutosave | null>(null)

export function PortalDraftAutosaveProvider({
  children,
  delayMs,
}: Readonly<{
  children: ReactNode
  /** The debounce of every key; the editor's own default when omitted. */
  delayMs?: number
}>) {
  const [autosave] = useState(() =>
    createPortalDraftAutosave(delayMs === undefined ? {} : { delayMs }),
  )
  // Edits still inside their debounce are written when the workspace goes away.
  // The cleanup is safe to run twice (StrictMode): with nothing waiting it does
  // nothing.
  useEffect(() => () => autosave.flushOnTeardown(), [autosave])
  return (
    <PortalDraftAutosaveContext value={autosave}>{children}</PortalDraftAutosaveContext>
  )
}

/** The coordinator itself: a stable object, so passing it around never re-renders. */
export function usePortalDraftAutosave(): PortalDraftAutosave {
  const autosave = useContext(PortalDraftAutosaveContext)
  if (autosave === null) {
    // A form that autosaves without a coordinator would silently never save.
    throw new Error('usePortalDraftAutosave needs a PortalDraftAutosaveProvider above it')
  }
  return autosave
}

/** The coordinator's status, re-rendering the caller when it changes. */
export function usePortalDraftAutosaveState(): PortalDraftAutosaveState {
  const autosave = usePortalDraftAutosave()
  return useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState)
}
