// Create property — route defines mutation, renders form component.

import { createFileRoute, useNavigate, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { createProperty } from '#/contexts/property/server/properties'
import { CreatePropertyForm } from '#/components/features/property/CreatePropertyForm'
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
import { useAction, wrapAction } from '#/components/hooks/use-action'

export const Route = createFileRoute('/_authenticated/properties/new')({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'property.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  component: CreatePropertyPage,
})

function CreatePropertyPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const createPropertyFn = useAction(useServerFn(createProperty))

  const mutation = wrapAction(createPropertyFn, async () => {
    await router.invalidate()
    navigate({ to: '/properties' })
  })

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">New Property</CardTitle>
          <CardDescription>Add a new property to your organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePropertyForm mutation={mutation} />
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: '/properties' })}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
