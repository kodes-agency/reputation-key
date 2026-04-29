// Property layout — shared shell with header + tab navigation.
// Child routes (overview, teams, staff) render via <Outlet />.

import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getProperty, deleteProperty } from '#/contexts/property/server/properties'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { AlertCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouterState } from '@tanstack/react-router'
import { useAction } from '#/components/hooks/use-action'

export const Route = createFileRoute('/_authenticated/properties/$propertyId')({
  loader: async ({ params: { propertyId } }) => {
    const res = await getProperty({ data: { propertyId } })
    return { property: res.property }
  },
  component: PropertyLayout,
})

function PropertyLayout() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const { property } = Route.useLoaderData()

  const deletePropertyFn = useAction(useServerFn(deleteProperty))

  async function handleDelete() {
    if (!window.confirm('Are you sure you want to delete this property?')) return
    try {
      await deletePropertyFn({ data: { propertyId } })
      await router.invalidate()
      toast.success('Property deleted')
      navigate({ to: '/properties' })
    } catch (error) {
      toast.error('Failed to delete property', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  if (!property) {
    return (
      <div className="page-wrap px-4 pb-8 pt-14">
        <Card className="island-shell rise-in rounded-2xl">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>Property not found.</AlertDescription>
            </Alert>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => navigate({ to: '/properties' })}
            >
              Back to Properties
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Determine active tab from current path
  const activeTab = currentPath.endsWith('/staff')
    ? 'staff'
    : currentPath.endsWith('/teams')
      ? 'teams'
      : 'overview'

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">{property.name}</CardTitle>
          <CardDescription>
            {property.slug} · {property.timezone}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Tab navigation */}
          <Tabs value={activeTab} className="w-full">
            <TabsList>
              <TabsTrigger value="overview" asChild>
                <Link to="/properties/$propertyId" params={{ propertyId }}>
                  Overview
                </Link>
              </TabsTrigger>
              <TabsTrigger value="teams" asChild>
                <Link to="/properties/$propertyId/teams" params={{ propertyId }}>
                  Teams
                </Link>
              </TabsTrigger>
              <TabsTrigger value="staff" asChild>
                <Link to="/properties/$propertyId/staff" params={{ propertyId }}>
                  Staff
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Child route content */}
          <div className="mt-6">
            <Outlet />
          </div>

          {/* Delete — always visible at bottom */}
          <Separator className="my-6" />
          <div>
            <h3 className="mb-2 text-sm font-semibold text-destructive">Danger Zone</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              This property will be hidden from your organization. Its data will be
              preserved but it will no longer appear in lists.
            </p>
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={deletePropertyFn.isPending}
              onClick={handleDelete}
            >
              <Trash2 />
              {deletePropertyFn.isPending ? 'Deleting…' : 'Delete Property'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
