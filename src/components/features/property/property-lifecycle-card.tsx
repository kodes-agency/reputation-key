import { Archive } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  PropertyLifecycleActions,
  type PropertyLifecycleActionSet,
} from './property-lifecycle-actions'
import {
  formatPropertyRecoveryDeadline,
  getPropertyLifecycleControls,
  GOOGLE_BINDING_STATUS,
  PROPERTY_LIFECYCLE_STATUS,
  type GoogleBindingState,
  type LifecyclePermissions,
  type PropertyLifecycleState,
} from './property-lifecycle-model'

export function PropertyLifecycleCard({
  property,
  responsibilityNeeded,
  actions,
  permissions,
}: Readonly<{
  property: Readonly<{
    id: string
    name: string
    lifecycleState: PropertyLifecycleState
    lifecycleReason: string | null
    purgeScheduledFor: Date | string | null
    googleBindingState: GoogleBindingState
  }>
  responsibilityNeeded: boolean
  actions: PropertyLifecycleActionSet
  permissions: LifecyclePermissions
}>) {
  const controls = getPropertyLifecycleControls({
    lifecycleState: property.lifecycleState,
    googleBindingState: property.googleBindingState,
    responsibilityNeeded,
  })
  const recoveryDeadline = formatPropertyRecoveryDeadline(property.purgeScheduledFor)

  return (
    <section
      className="overflow-hidden rounded-lg border"
      aria-labelledby="property-lifecycle-title"
    >
      <div className="flex flex-col gap-4 border-b bg-muted/25 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Archive className="size-4" aria-hidden="true" />
            <h2 id="property-lifecycle-title" className="font-semibold">
              Property lifecycle
            </h2>
            <StatusBadge
              status={property.lifecycleState}
              map={PROPERTY_LIFECYCLE_STATUS}
            />
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Archive pauses guest access, publication, and new Google work while keeping
            this Property&apos;s settings, history, metrics, and stable identity available
            for recovery.
          </p>
        </div>
        <StatusBadge status={property.googleBindingState} map={GOOGLE_BINDING_STATUS} />
      </div>

      <div className="space-y-4 p-4">
        {property.lifecycleState === 'archived' && (
          <Alert variant="info" role="status">
            <AlertTitle>Recovery details</AlertTitle>
            <AlertDescription>
              <p>
                {recoveryDeadline
                  ? `Self-service recovery is available before ${recoveryDeadline}. After that date, the Property remains safely archived and support can help with next steps.`
                  : 'This Property remains safely archived. Contact support if the recovery date is unavailable.'}
              </p>
              {property.lifecycleReason && (
                <p>Archive note: {property.lifecycleReason}</p>
              )}
              {controls.restoreDisabled && (
                <p className="font-medium text-foreground">
                  Assign an eligible Responsible Manager above before restoring.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <PropertyLifecycleActions
          property={property}
          controls={controls}
          permissions={permissions}
          actions={actions}
        />
      </div>
    </section>
  )
}
