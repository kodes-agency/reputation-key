// Dashboard — protected route showing organization info
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authClient } from '#/shared/auth/auth-client'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Skeleton } from '#/components/ui/skeleton'
import { Separator } from '#/components/ui/separator'
import { AlertCircle, LogOut } from 'lucide-react'
import {
  listUserOrganizations,
  setActiveOrganization,
} from '#/contexts/identity/server/organizations'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const ctx = Route.useRouteContext()
  const user = (ctx as { user?: { name: string } }).user
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
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-2xl">Dashboard</CardTitle>
              <CardDescription>
                Welcome back, {user?.name || 'User'}!
                {activeOrg && (
                  <span className="ml-2 text-sm">
                    · <span className="font-medium text-primary">{activeOrg.name}</span>
                  </span>
                )}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => authClient.signOut()}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {orgQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : orgQuery.error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Failed to load organizations</AlertTitle>
              <AlertDescription>Please refresh the page.</AlertDescription>
            </Alert>
          ) : orgs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="font-medium">No organization found.</p>
                <p className="text-sm text-muted-foreground">
                  Your account exists but no organization is set up. Please contact
                  support.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {orgs.length > 1 && (
                <>
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-semibold">Switch Organization</p>
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
                  <Separator />
                </>
              )}

              <p className="text-sm text-muted-foreground">
                Your dashboard is ready. Product features will appear here as they're
                built.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
