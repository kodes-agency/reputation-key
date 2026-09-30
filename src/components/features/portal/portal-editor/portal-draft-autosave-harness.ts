// Shared setup for the autosave coordinator tests: fake timers, a coordinator
// with a fixed clock, and a recorder of every state it published.

import { vi } from 'vitest'
import {
  createPortalDraftAutosave,
  type PortalDraftAutosaveState,
  type PortalDraftSave,
} from './portal-draft-autosave'

export const saved: PortalDraftSave = async () => 'saved'

export function harness(delayMs = 800) {
  vi.useFakeTimers()
  const states: PortalDraftAutosaveState[] = []
  const autosave = createPortalDraftAutosave({ delayMs, now: () => 1_000 })
  autosave.subscribe(() => states.push(autosave.getState()))
  return { autosave, states, statuses: () => states.map((state) => state.status) }
}
