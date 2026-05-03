import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { MessageSquare, Users, Globe, TrendingUp } from 'lucide-react'
import { Button } from '#/components/ui/button'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  component: PropertyDashboard,
})

function PropertyDashboard() {
  const { property, staffCount, teamCount } = propertyRoute.useLoaderData()
  const { propertyId } = propertyRoute.useParams()

  if (!property) return null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{property.name}</p>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link
          to="/properties/$propertyId/reviews"
          params={{ propertyId }}
          className="group rounded-lg border p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Reviews</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">—</p>
        </Link>

        <Link
          to="/properties/$propertyId/people"
          params={{ propertyId }}
          className="group rounded-lg border p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Staff</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{staffCount}</p>
        </Link>

        <Link
          to="/properties/$propertyId/people"
          params={{ propertyId }}
          className="group rounded-lg border p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Teams</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{teamCount}</p>
        </Link>

        <Link
          to="/properties/$propertyId/portals"
          params={{ propertyId }}
          className="group rounded-lg border p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Globe className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Portals</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">—</p>
        </Link>
      </div>

      {/* Recent reviews — placeholder until review server functions exist */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Recent Reviews
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/properties/$propertyId/reviews" params={{ propertyId }}>
              View all
            </Link>
          </Button>
        </div>
        <div className="mt-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Review data will appear here once the reviews context is connected.
        </div>
      </div>
    </div>
  )
}
