// BETA-2 B2.1: Permission and capability-denied states.
// Shown when a user navigates to a page they don't have permission for.

import { ShieldAlert, Lock } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'

type PermissionProps = Readonly<{ onGoHome?: () => void }>

/** User lacks the role/permission for this page. */
export function PermissionDeniedState({ onGoHome }: PermissionProps) {
  return (
    <EmptyState icon={ShieldAlert} title="You don't have access to this page">
      <p className="text-sm text-muted-foreground max-w-sm">
        Your role doesn't include permission for this area. Contact your administrator if
        you believe this is an error.
      </p>
      {onGoHome && (
        <Button variant="outline" size="sm" onClick={onGoHome}>
          Go to home
        </Button>
      )}
    </EmptyState>
  )
}

/** Feature is disabled by beta capability policy. */
export function CapabilityDisabledState({ feature }: Readonly<{ feature: string }>) {
  return (
    <EmptyState icon={Lock} title={`${feature} is not available`}>
      <p className="text-sm text-muted-foreground max-w-sm">
        This feature is disabled during the beta program. It will be enabled in a future
        update.
      </p>
    </EmptyState>
  )
}
