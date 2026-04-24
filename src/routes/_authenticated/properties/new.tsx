// Create property — route defines mutation, renders form component.
// Per conventions: route imports server function, creates useMutation, passes to form.
// Form component never imports server functions directly (dependency rules).

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { createProperty } from '#/contexts/property/server/properties'
import { CreatePropertyForm } from '#/components/features/property/CreatePropertyForm'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/_authenticated/properties/new')({
  component: CreatePropertyPage,
})

function CreatePropertyPage() {
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (input: { data: Parameters<typeof createProperty>[0]['data'] }) =>
      createProperty(input),
    onSuccess: () => {
      navigate({ to: '/properties' })
    },
  })

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
        <div className="mb-6">
          <h1 className="mb-1 text-2xl font-bold text-[var(--sea-ink)]">New Property</h1>
          <p className="text-[var(--sea-ink-soft)]">
            Add a new property to your organization.
          </p>
        </div>

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
      </section>
    </div>
  )
}
