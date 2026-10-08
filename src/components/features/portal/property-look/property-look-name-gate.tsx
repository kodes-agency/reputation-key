// What Property look shows while the property has no public display name: the
// look is that name dressed in its colours, so there is nothing to look at yet.
// An account admin sets the name right here (the same card as property settings,
// saved through the same narrow writer) and the page opens as soon as it is
// saved; anyone else is told who can.
import { Palette } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import {
  PropertyPublicDisplayNameCard,
  type SavePublicDisplayNameAction,
} from '#/components/features/property/property-public-display-name-card'

export function PropertyLookNameGate({
  propertyId,
  canEdit,
  saveDisplayName,
}: Readonly<{
  propertyId: string
  /** An account admin, with portal writes on. */
  canEdit: boolean
  /** Saves the name alone; left out where the page cannot (a reader without the right). */
  saveDisplayName?: SavePublicDisplayNameAction
}>) {
  if (canEdit && saveDisplayName) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Palette}
          title="Set the public display name first"
          description="The look is the property’s public display name dressed in its colours. Guests see the name at the top of every portal."
        />
        <PropertyPublicDisplayNameCard
          propertyId={propertyId}
          displayName=""
          action={saveDisplayName}
          showLookLink={false}
        />
      </div>
    )
  }
  return (
    <EmptyState
      icon={Palette}
      title="Set the public display name first"
      description="The look is the property’s public display name dressed in its colours. Ask an account admin to set it."
    />
  )
}
