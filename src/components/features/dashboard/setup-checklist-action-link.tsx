import { Link } from '@tanstack/react-router'
import type { SetupChecklistAction } from '#/contexts/reporting/application/public-api'
import { Button } from '#/components/ui/button'

export function SetupChecklistActionLink({
  action,
}: Readonly<{ action: SetupChecklistAction }>) {
  switch (action.kind) {
    // Connecting Google and the first review sync are both reached through the
    // import flow, the one way a property is created (decision 7). A broken
    // connection is not a separate action; the import page itself sends a
    // manager to Integrations when no connection can be used.
    case 'manage_google':
      return (
        <Button asChild size="sm" variant="outline">
          <Link to="/properties/import-google">Import from Google</Link>
        </Button>
      )
    case 'assign_managers':
      return action.propertyId ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/properties/$propertyId/settings/people"
            params={{ propertyId: action.propertyId }}
          >
            Assign managers
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
