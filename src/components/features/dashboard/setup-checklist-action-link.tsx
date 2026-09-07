import { Link } from '@tanstack/react-router'
import type { SetupChecklistAction } from '#/contexts/dashboard/application/public-api'
import { Button } from '#/components/ui/button'

export function SetupChecklistActionLink({
  action,
}: Readonly<{ action: SetupChecklistAction }>) {
  switch (action.kind) {
    case 'manage_google':
      return (
        <Button asChild size="sm" variant="outline">
          <Link to="/settings/integrations">Review Google setup</Link>
        </Button>
      )
    case 'assign_managers':
      return action.propertyId ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/properties/$propertyId/settings"
            params={{ propertyId: action.propertyId }}
          >
            {action.kind === 'assign_managers' ? 'Assign managers' : 'Review property'}
          </Link>
        </Button>
      ) : null
    case 'manage_portals':
      return action.propertyId ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/properties/$propertyId/portals"
            params={{ propertyId: action.propertyId }}
          >
            Manage portals
          </Link>
        </Button>
      ) : null
  }
}
