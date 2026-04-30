// Portal context — shared tab navigation across portal detail routes.

import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Settings, Link2, Eye } from 'lucide-react'

type Tab = 'settings' | 'links' | 'preview'

type Props = Readonly<{
  propertyId: string
  portalId: string
  activeTab: Tab
}>

export function PortalTabNav({ propertyId, portalId, activeTab }: Props) {
  return (
    <div className="mb-6 flex gap-2">
      {activeTab === 'settings' ? (
        <Badge variant="default">
          <Settings className="mr-1 size-3" />
          Settings
        </Badge>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <Link to="/properties/$propertyId/portals/$portalId" params={{ propertyId, portalId }}>
            <Settings className="mr-1 size-3" />
            Settings
          </Link>
        </Button>
      )}

      {activeTab === 'links' ? (
        <Badge variant="default">
          <Link2 className="mr-1 size-3" />
          Links
        </Badge>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/properties/$propertyId/portals/$portalId/links"
            params={{ propertyId, portalId }}
          >
            <Link2 className="mr-1 size-3" />
            Links
          </Link>
        </Button>
      )}

      {activeTab === 'preview' ? (
        <Badge variant="default">
          <Eye className="mr-1 size-3" />
          Preview
        </Badge>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/properties/$propertyId/portals/$portalId/preview"
            params={{ propertyId, portalId }}
          >
            <Eye className="mr-1 size-3" />
            Preview
          </Link>
        </Button>
      )}
    </div>
  )
}
