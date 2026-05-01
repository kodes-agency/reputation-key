// Portal preview — shows a mock preview of the guest-facing portal
import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent } from '#/components/ui/card'
import { usePortalLayout } from '../$portalId'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/preview',
)({
  component: PortalPreviewPage,
})

function PortalPreviewPage() {
  const { portal } = usePortalLayout()

  return (
    <div className="mx-auto max-w-md">
      <Card className="overflow-hidden">
        <div
          className="flex h-48 items-end p-6"
          style={{
            backgroundColor: portal.theme.primaryColor,
          }}
        >
          <div>
            <h2 className="text-2xl font-bold text-white">{portal.name}</h2>
            {portal.description && (
              <p className="mt-1 text-sm text-white/80">{portal.description}</p>
            )}
          </div>
        </div>

        <CardContent className="p-6">
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm text-muted-foreground">
              Portal preview. Add categories and links in the Links tab.
            </p>

            {portal.smartRoutingEnabled && (
              <div className="rounded-lg border p-3 text-center text-sm">
                <p className="text-muted-foreground">
                  Smart Routing: ON (threshold: {portal.smartRoutingThreshold}+ stars)
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
