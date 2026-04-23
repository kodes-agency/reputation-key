// Dashboard — protected route showing organization info
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authClient } from '#/shared/auth/auth-client'
import { Button } from '#/components/ui/button'
import {
  listUserOrganizations,
  setActiveOrganization,
} from '#/contexts/identity/server/organizations'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()

  const orgQuery = useQuery({
    queryKey: ['userOrganizations'],
    queryFn: () => listUserOrganizations(),
  })

  const setActiveOrgMutation = useMutation({
    mutationFn: (orgId: string) =>
      setActiveOrganization({ data: { organizationId: orgId } }),
  })

  const orgs = orgQuery.data?.organizations ?? []
  // Auto-set first org as active once loaded
  const activeOrg = orgs.length > 0 ? orgs[0] : null

  function handleSetActive(orgId: string) {
    setActiveOrgMutation.mutate(orgId, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['userOrganizations'] })
      },
    })
  }

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-[var(--sea-ink)]">Dashboard</h1>
            <p className="text-[var(--sea-ink-soft)]">
              Welcome back, {session?.user?.name ?? 'User'}!
              {activeOrg && (
                <span className="ml-2 text-sm">
                  ·{' '}
                  <span className="font-medium text-[var(--lagoon)]">
                    {activeOrg.name}
                  </span>
                </span>
              )}
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => authClient.signOut()}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--sea-ink)] transition hover:bg-[var(--surface-strong)]"
            >
              Sign out
            </button>
          </div>
        </div>

        {orgQuery.isLoading ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
        ) : orgQuery.error ? (
          <p className="text-sm text-red-600">Failed to load organizations.</p>
        ) : (
          <>
            {/* Organization switcher (for multi-org users) */}
            {orgs.length > 1 && (
              <div className="mb-6 rounded-lg border border-[var(--line)] p-4">
                <h2 className="mb-2 text-sm font-semibold text-[var(--sea-ink)]">
                  Switch Organization
                </h2>
                <div className="flex flex-wrap gap-2">
                  {orgs.map((org) => (
                    <Button
                      key={org.id}
                      size="sm"
                      variant={activeOrg?.id === org.id ? 'default' : 'outline'}
                      onClick={() => handleSetActive(org.id)}
                    >
                      {org.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-sm text-[var(--sea-ink-soft)]">
              Your dashboard is ready. Product features will appear here as they're built.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
