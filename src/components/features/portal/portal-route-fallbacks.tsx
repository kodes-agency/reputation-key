import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { PageShell } from '#/components/layout/page-shell'

export function PortalListLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portals and portal groups" />
    </PageShell>
  )
}

export function PortalListError({ error }: Readonly<{ error: Error }>) {
  return (
    <PageShell>
      <PageHeader title="Portals" description="Manage this property’s public pages." />
      <ErrorState message={error.message || 'Portals could not be loaded.'} />
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

export function CreatePortalError({ error }: Readonly<{ error: Error }>) {
  return (
    <PageShell>
      <PageHeader
        title="New Portal"
        description="Create a public page for this property."
      />
      <ErrorState message={error.message || 'The portal editor could not be loaded.'} />
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

export function PortalDetailError({ error }: Readonly<{ error: Error }>) {
  return (
    <PageShell>
      <PageHeader title="Portal" description="Manage this property’s public page." />
      <ErrorState message={error.message || 'This portal could not be loaded.'} />
    </PageShell>
  )
}
