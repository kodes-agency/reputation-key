// A property row's actions (docs/plan/property-list-table.md row 9). Every item
// is a link to where the work happens: removing a property opens the danger
// zone, whose dialogs and responsible-manager checks live there, so nothing in
// the list can change a property by accident.
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'

export function PropertyRowActions({
  propertyId,
  propertyName,
}: Readonly<{ propertyId: string; propertyName: string }>) {
  const { can } = usePermissions()
  return (
    <RowActionsMenu name={propertyName}>
      <RowActionsItem asChild>
        <Link to="/properties/$propertyId" params={{ propertyId }}>
          Open overview
        </Link>
      </RowActionsItem>
      <RowActionsItem asChild>
        <Link to="/properties/$propertyId/reviews" params={{ propertyId }}>
          Reviews
        </Link>
      </RowActionsItem>
      <RowActionsItem asChild>
        <Link to="/properties/$propertyId/settings" params={{ propertyId }}>
          Settings
        </Link>
      </RowActionsItem>
      {can('property.archive') ? (
        <>
          <RowActionsSeparator />
          <RowActionsItem asChild destructive>
            <Link to="/properties/$propertyId/settings/danger" params={{ propertyId }}>
              Remove from workspace…
            </Link>
          </RowActionsItem>
        </>
      ) : null}
    </RowActionsMenu>
  )
}
