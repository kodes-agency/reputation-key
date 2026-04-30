// Create portal — route defines mutation, renders form component.

import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { createPortal } from '#/contexts/portal/server/portals'
import { CreatePortalForm } from '#/components/features/portal/CreatePortalForm'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { redirect } from '@tanstack/react-router'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { ArrowLeft } from 'lucide-react'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/new',
)({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'portal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  component: CreatePortalPage,
})

function CreatePortalPage() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()

  const mutation = useMutationAction(createPortal, {
    successMessage: 'Portal created',
    onSuccess: async (output) => {
      navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: {
          propertyId,
          portalId: output.portal.id,
        },
      })
    },
  })

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Button variant="ghost" asChild className="mb-4">
        <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
          <ArrowLeft />
          Back to Portals
        </Link>
      </Button>

      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Create Portal</CardTitle>
          <CardDescription>Set up a new guest-facing portal page.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePortalForm propertyId={propertyId} mutation={mutation} />
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: '/properties/$propertyId/portals', params: { propertyId } })}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
