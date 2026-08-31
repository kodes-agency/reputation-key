import { Archive, CalendarClock } from 'lucide-react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Badge } from '#/components/ui/badge'
import {
  PropertyArchiveDialog,
  PropertyGoogleDisconnectDialog,
  PropertyRestoreDialog,
  type ArchiveLifecycleAction,
  type TargetLifecycleAction,
} from './property-lifecycle-dialogs'

type PropertyLifecycleState =
  | 'active'
  | 'suspended'
  | 'archived'
  | 'disconnecting'
  | 'purge_pending'
  | 'purging'
  | 'purged'

type GoogleBindingState =
  'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'

type LifecycleControls = Readonly<{
  showArchive: boolean
  showRestore: boolean
  showDisconnect: boolean
  restoreDisabled: boolean
  statusLabel: string
}>

const LIFECYCLE_LABELS: Readonly<Record<PropertyLifecycleState, string>> = {
  active: 'Active',
  suspended: 'Paused',
  archived: 'Archived',
  disconnecting: 'Disconnecting',
  purge_pending: 'Support review',
  purging: 'Unavailable',
  purged: 'Unavailable',
}

export const getPropertyLifecycleControls = (input: {
  lifecycleState: PropertyLifecycleState
  googleBindingState: GoogleBindingState
  responsibilityNeeded: boolean
}): LifecycleControls => ({
  showArchive: input.lifecycleState === 'active' || input.lifecycleState === 'suspended',
  showRestore: input.lifecycleState === 'archived',
  showDisconnect:
    input.lifecycleState === 'archived' && input.googleBindingState === 'active',
  restoreDisabled: input.responsibilityNeeded,
  statusLabel: LIFECYCLE_LABELS[input.lifecycleState],
})

export const formatPropertyRecoveryDeadline = (
  value: Date | string | null,
): string | null => {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

const googleBindingLabel = (state: GoogleBindingState): string => {
  switch (state) {
    case 'active':
      return 'Google connected for this Property'
    case 'disconnected':
      return 'Google reconnection needed'
    case 'account_confirmation_required':
      return 'Google account confirmation needed'
    case 'unbound':
      return 'No Google profile linked'
  }
}

export function PropertyLifecycleCard({
  property,
  responsibilityNeeded,
  archiveAction,
  restoreAction,
  disconnectAction,
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
  archiveAction: ArchiveLifecycleAction
  restoreAction: TargetLifecycleAction
  disconnectAction: TargetLifecycleAction
  permissions: Readonly<{
    archive: boolean
    restore: boolean
    disconnect: boolean
  }>
}>) {
  const controls = getPropertyLifecycleControls({
    lifecycleState: property.lifecycleState,
    googleBindingState: property.googleBindingState,
    responsibilityNeeded,
  })
  const recoveryDeadline = formatPropertyRecoveryDeadline(property.purgeScheduledFor)
  const pending =
    archiveAction.isPending || restoreAction.isPending || disconnectAction.isPending

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
            <Badge variant="outline">{controls.statusLabel}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Archive pauses guest access, publication, and new Google work while keeping
            this Property&apos;s settings, history, metrics, and stable identity available
            for recovery.
          </p>
        </div>
        <Badge variant="secondary">
          {googleBindingLabel(property.googleBindingState)}
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        {property.lifecycleState === 'archived' && (
          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CalendarClock className="size-4" aria-hidden="true" />
              Recovery details
            </div>
            <p className="mt-1 text-muted-foreground">
              {recoveryDeadline
                ? `Self-service recovery is available before ${recoveryDeadline}. After that date, the Property remains safely archived and support can help with next steps.`
                : 'This Property remains safely archived. Contact support if the recovery date is unavailable.'}
            </p>
            {property.lifecycleReason && (
              <p className="mt-2 text-muted-foreground">
                Archive note: {property.lifecycleReason}
              </p>
            )}
            {controls.restoreDisabled && (
              <p className="mt-2 font-medium">
                Assign an eligible Responsible Manager above before restoring.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {controls.showArchive && (
            <PropertyArchiveDialog
              propertyId={property.id}
              propertyName={property.name}
              action={archiveAction}
              disabled={!permissions.archive || pending}
            />
          )}

          {controls.showRestore && (
            <PropertyRestoreDialog
              propertyId={property.id}
              propertyName={property.name}
              action={restoreAction}
              disabled={!permissions.restore || pending || controls.restoreDisabled}
            />
          )}

          {controls.showDisconnect && (
            <PropertyGoogleDisconnectDialog
              propertyId={property.id}
              propertyName={property.name}
              action={disconnectAction}
              disabled={!permissions.disconnect || pending}
            />
          )}
        </div>

        <FormErrorBanner
          error={archiveAction.error ?? restoreAction.error ?? disconnectAction.error}
        />
      </div>
    </section>
  )
}
