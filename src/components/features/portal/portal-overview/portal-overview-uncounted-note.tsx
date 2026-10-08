// Under the results strip: the Portals whose scans are not in its figures. Their
// own rows print a dash for scans; the strip adds Portals up, and a sum that leaves
// some out has to say so, or a manager with an older printed code reads a low number
// as guests not coming. One Portal is named and linked to Share, where its code is
// replaced; more than one are counted, because each row already says so.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { FixLink } from './portal-issues-popover'
import { portalLineLinkClass } from './portal-line-link'

export type UncountedScanPortal = Pick<
  PortalOverviewRow,
  'portalId' | 'propertyId' | 'name'
>

export function UncountedScansNote({
  portals,
}: Readonly<{ portals: readonly UncountedScanPortal[] }>) {
  const [only] = portals
  if (only === undefined) return null
  if (portals.length > 1) {
    return (
      <p className="text-xs text-muted-foreground">
        Scans for {portals.length} portals aren’t in these figures: their codes are older
        than scan counting. Each is marked in the list.
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      Scans for{' '}
      <FixLink
        fix="share"
        portalId={only.portalId}
        propertyId={only.propertyId}
        ariaLabel={`Open Share for ${only.name}`}
        className={portalLineLinkClass()}
      >
        {only.name}
      </FixLink>{' '}
      aren’t in these figures: its code is older than scan counting. Replacing the code
      counts them, and the printed code has to be swapped.
    </p>
  )
}
