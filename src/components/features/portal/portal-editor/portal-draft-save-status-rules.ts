// What the header's autosave line says for each state of the coordinator. The
// server's own sentence for a refused write (a portal that was archived, say) is added
// by the component, which owns the error-to-words mapping.

import type { PortalDraftAutosaveState } from './portal-draft-autosave'

export type PortalDraftSaveStatusView = Readonly<{
  label: string
  tone: 'busy' | 'ok' | 'warn'
  canRetry: boolean
}>

export function describePortalDraftSaveStatus(
  state: PortalDraftAutosaveState,
): PortalDraftSaveStatusView | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'pending':
    case 'saving':
      return { label: 'Saving…', tone: 'busy', canRetry: false }
    case 'saved':
      return { label: 'Draft saved', tone: 'ok', canRetry: false }
    case 'invalid':
      return {
        label: 'Not saved · check the highlighted fields',
        tone: 'warn',
        canRetry: false,
      }
    case 'error':
      return { label: 'Not saved', tone: 'warn', canRetry: true }
  }
}
