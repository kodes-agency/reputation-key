// Create property — route defines mutation, renders form component.

import {
  createFileRoute,
  useNavigate,
  redirect,
  useRouter,
  Link,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { createProperty } from '#/contexts/property/server/properties'
import { CreatePropertyForm } from '#/components/features/property/CreatePropertyForm'
import { Button } from '#/components/ui/button'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useAction, wrapAction } from '#/components/hooks/use-action'
import { ArrowLeft } from 'lucide-react'

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
    <div className="mx-auto max-w-2xl space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/properties">
          <ArrowLeft />
          Back to Properties
        </Link>
      </Button>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">New Property</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new property to your organization.
        </p>
      </div>

      <CreatePropertyForm mutation={mutation} />
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: '/properties' })}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
