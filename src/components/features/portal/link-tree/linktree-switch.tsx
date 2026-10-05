// "Show on the page": whether guests see the Linktree at all. Turning it off
// keeps every tile. It is saved at once, after any typed text still waiting; the
// switch moves as it is flipped (the write is optimistic), so it passes no `pending`
// and the row says "Saving…" and "Saved" from the save's promise. A refusal rolls the
// switch back and is a toast, which the mutation reports.

import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  portalId: string
  enabled: boolean
  save: LinktreeMutations['saveSettings']
  disabled: boolean
}>

export function LinktreeSwitch({ portalId, enabled, save, disabled }: Props) {
  const autosave = usePortalDraftAutosave()
  return (
    <SettingSwitchRow
      id="linktree-enabled"
      label="Show on the page"
      commit="immediate"
      checked={enabled}
      disabled={disabled}
      onCheckedChange={(next) =>
        autosave.flush().then(() => save({ data: { portalId, enabled: next } }))
      }
    />
  )
}
