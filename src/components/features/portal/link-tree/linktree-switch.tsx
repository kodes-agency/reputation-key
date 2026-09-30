// "Show on the page": whether guests see the Linktree at all. Turning it off
// keeps every tile. It is saved at once, after any typed text still waiting.

import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
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
    <div className="flex items-center gap-2">
      <Label htmlFor="linktree-enabled" className="text-sm font-normal">
        Show on the page
      </Label>
      <Switch
        id="linktree-enabled"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(next) => {
          void autosave
            .flush()
            .then(() => save({ data: { portalId, enabled: next } }))
            .catch(() => undefined)
        }}
      />
    </div>
  )
}
