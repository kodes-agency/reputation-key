// A portal's look as it was before portals could have their own: the property's
// accent and name in a swatch, and the way to the page where they are edited. It
// is what a property with one portal sees, and what anyone sees while the switch
// for a portal's own look is off and the portal has none.
import { Link } from '@tanstack/react-router'
import { Palette } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { PortalExperienceSettings } from '../portal-settings/portal-experience-settings-types'

type Props = Readonly<{
  propertyId: string
  profile: PortalExperienceSettings['profile']
  /** An Account Admin who may change the property's look. */
  canManage: boolean
}>

export function PortalLookSummary({ propertyId, profile, canManage }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border px-4 py-3">
      {profile ? (
        <div className="flex items-center gap-3">
          <span
            role="img"
            aria-label={`Accent colour ${profile.primaryColor}`}
            className="size-8 shrink-0 rounded-md border"
            style={{ backgroundColor: profile.primaryColor }}
          />
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">{profile.displayName}</p>
            <p className="text-muted-foreground">
              Accent {profile.primaryColor.toUpperCase()}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          The property has no public display name yet, so there is no look to show.
        </p>
      )}
      <Button variant="outline" asChild>
        <Link to="/properties/$propertyId/portals/look" params={{ propertyId }}>
          <Palette />
          {canManage ? 'Edit the property look' : 'See the property look'}
        </Link>
      </Button>
    </div>
  )
}
