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

export function PortalDetailLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portal details" />
    </PageShell>
  )
}

export function PortalDetailError({ error }: ErrorComponentProps) {
  return (
    <PageShell>
      <PageHeader title="Portal" description="Manage this property’s public page." />
      <ErrorState message={errorMessage(error) || 'This portal could not be loaded.'} />
    </PageShell>
  )
}
