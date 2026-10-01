import type { ReactNode } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { PageShell } from '#/components/layout/page-shell'
import { errorMessage } from '#/shared/security/error-display'

export function PortalListLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portals and portal groups" />
    </PageShell>
  )
}

export function PortalListError({ error }: ErrorComponentProps) {
  return (
    <PageShell>
      <PageHeader title="Portals" description="Manage this property’s public pages." />
      <ErrorState message={errorMessage(error) || 'Portals could not be loaded.'} />
    </PageShell>
  )
}

/** The All properties page's own: its Portals are the Organization's, not one Property's. */
export function PortalAllPropertiesError({ error }: ErrorComponentProps) {
  return (
    <PageShell>
      <PageHeader
        title="Portals"
        description="Public pages across all of your properties."
      />
      <ErrorState message={errorMessage(error) || 'Portals could not be loaded.'} />
    </PageShell>
  )
}

export function CreatePortalLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portal editor" />
    </PageShell>
  )
}

export function CreatePortalError({ error }: ErrorComponentProps) {
  return (
    <PageShell>
      <PageHeader
        title="New Portal"
        description="Create a public page for this property."
      />
      <ErrorState
        message={errorMessage(error) || 'The portal editor could not be loaded.'}
      />
    </PageShell>
  )
}

/**
 * The portal workspace is full-bleed (see `isWorkspaceRoute`): the layout above
 * it clips overflow and pads nothing. Its loading, error and not-found states
 * render in that same frame, so they bring their own padding and their own
 * scroll instead of being cut off at the viewport.
 */
export function PortalFallbackFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="h-full overflow-y-auto px-4 py-5 md:px-6 md:py-8">
      <PageShell>{children}</PageShell>
    </div>
  )
}

export function PortalDetailLoading() {
  return (
    <PortalFallbackFrame>
      <LoadingState label="Loading portal details" />
    </PortalFallbackFrame>
  )
}

export function PortalDetailError({ error }: ErrorComponentProps) {
  return (
    <PortalFallbackFrame>
      <PageHeader title="Portal" description="Manage this property’s public page." />
      <ErrorState message={errorMessage(error) || 'This portal could not be loaded.'} />
    </PortalFallbackFrame>
  )
}
