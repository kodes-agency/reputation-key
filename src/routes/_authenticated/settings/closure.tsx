// LIF-01-T17 — /settings/closure, the Closure Center route.
//
// The route guard is role-only and deliberately NOT capability-gated. Every
// other settings route can lean on the capability check, but a closure
// suspends the Organization, which denies every capability — so gating this
// page the usual way would lock the tenant out of the only surface that can
// cancel the closure or download their export. The server functions re-check
// "current AccountAdmin with an active Organization binding" under lock, which
// is the authority that actually matters.

import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { hasRole } from '#/shared/domain/roles'
import { identityKeys } from '#/shared/queries/query-keys'
import { ClosureCenter } from '#/components/features/closure/closure-center'
import {
  cancelOrganizationClosureFn,
  downloadOrganizationExportFn,
  getClosureCenterFn,
  issueOrganizationExportRetrievalFn,
  reactivateOrganizationFn,
  requestOrganizationClosureFn,
  requestOrganizationExportFn,
} from '#/contexts/identity/server/organization-closure-fns'

const closureCenterQuery = queryOptions({
  queryKey: identityKeys.closureCenter(),
  queryFn: () => getClosureCenterFn(),
  // The recovery deadline and the export state both move; a stale read here
  // could show a cancel button for a window that has already closed.
  staleTime: 0,
})

export const Route = createFileRoute('/_authenticated/settings/closure')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!hasRole(role, 'AccountAdmin')) throw redirect({ to: '/settings/profile' })
  },
  // Prime the cache, return nothing: Query owns the payload, and returning it
  // as well would serialize a second copy into the SSR document.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(closureCenterQuery)
  },
  component: ClosureRoute,
})

/** Hands the decoded archive to the browser without ever putting it in a URL. */
function saveArchive(input: Readonly<{ filename: string; archiveBase64: string }>): void {
  const binary = atob(input.archiveBase64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = input.filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function ClosureRoute() {
  const { data: view } = useSuspenseQuery(closureCenterQuery)
  // Every command changes the lifecycle or the export state this page reads,
  // so all six invalidate exactly one targeted key.
  const invalidateKeys = [identityKeys.closureCenter()]

  const requestClosure = useActionMutation(requestOrganizationClosureFn, {
    invalidateKeys,
  })
  const cancelClosure = useActionMutation(cancelOrganizationClosureFn, {
    invalidateKeys,
  })
  const reactivate = useActionMutation(reactivateOrganizationFn, { invalidateKeys })
  const requestExport = useActionMutation(requestOrganizationExportFn, {
    invalidateKeys,
  })
  const issueRetrieval = useActionMutation(issueOrganizationExportRetrievalFn, {
    invalidateKeys,
  })
  const downloadExport = useActionMutation(downloadOrganizationExportFn, {
    invalidateKeys,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Closure Center"
        description="Close this organization, download an export, or cancel a closure that is still recoverable."
      />
      <ClosureCenter
        view={view}
        requestClosure={requestClosure}
        cancelClosure={cancelClosure}
        reactivate={reactivate}
        requestExport={requestExport}
        issueRetrieval={issueRetrieval}
        downloadExport={downloadExport}
        onArchive={saveArchive}
      />
    </div>
  )
}
