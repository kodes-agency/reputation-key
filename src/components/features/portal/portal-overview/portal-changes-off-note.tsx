// One line of words for a Portals page that is read-only for a reason the person
// cannot see: their role may change portals, but the organisation's portal writes
// are switched off. Without it Edit, New portal and New group are simply missing.
import { Info } from 'lucide-react'
import { usePortalAccess } from './use-portal-access'

const PORTAL_CHANGES_OFF_LINE =
  'You can look at portals here, but changing them isn’t available for your organization right now.'

export function PortalChangesOffNote() {
  const { changesOff } = usePortalAccess()
  if (!changesOff) return null
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Info className="size-4 shrink-0" aria-hidden="true" />
      {PORTAL_CHANGES_OFF_LINE}
    </p>
  )
}
