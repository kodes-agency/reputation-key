// Look: the photo and colours guests see. They belong to the Property and are
// shared by every one of its portals, so they are edited once, on the Property
// look page; this section shows what the portal gets from it and opens that page.
import { Link } from '@tanstack/react-router'
import { Palette } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function LookSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portalExperience, propertyId } = resources
  const profile = portalExperience?.profile
  const canManage = canEdit && portalExperience?.canManagePropertyBrand === true
  return (
    <PortalEditorSectionFrame
      section="look"
      description="The photo and colours on this portal. They are shared by every portal at this property."
    >
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
        <Button variant="outline" className="min-h-11 sm:min-h-9" asChild>
          <Link to="/properties/$propertyId/portals/look" params={{ propertyId }}>
            <Palette />
            {canManage ? 'Edit the property look' : 'See the property look'}
          </Link>
        </Button>
      </div>
    </PortalEditorSectionFrame>
  )
}
