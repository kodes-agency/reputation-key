// Property detail — view and edit a property.
// Per conventions: route imports server functions, creates mutations,
// passes them to form components. Form components never import server functions.
// Uses TanStack Form + Zod schema from DTO for validation.

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  getProperty,
  updateProperty,
  deleteProperty,
} from '#/contexts/property/server/properties'
import { EditPropertyForm } from '#/components/features/property/EditPropertyForm'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/_authenticated/properties/$propertyId')({
  component: PropertyDetailPage,
})

function PropertyDetailPage() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)

  const query = useQuery({
    queryKey: ['property', propertyId],
    queryFn: async () => {
      const res = await getProperty({ data: { propertyId } })
      return res.property
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateProperty>[0]) => updateProperty(input),
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] })
      queryClient.invalidateQueries({ queryKey: ['properties'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteProperty({ data: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      navigate({ to: '/properties' })
    },
  })

  if (query.isLoading) {
    return (
      <div className="page-wrap px-4 pb-8 pt-14">
        <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
          <p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
        </section>
      </div>
    )
  }

  if (query.error || !query.data) {
    return (
      <div className="page-wrap px-4 pb-8 pt-14">
        <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
          <p className="text-sm text-red-600">Property not found.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => navigate({ to: '/properties' })}
          >
            Back to Properties
          </Button>
        </section>
      </div>
    )
  }

  const property = query.data

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-[var(--sea-ink)]">
              {editing ? 'Edit Property' : property.name}
            </h1>
            {!editing && (
              <p className="text-[var(--sea-ink-soft)]">
                {property.slug} · {property.timezone}
              </p>
            )}
          </div>
          {!editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>

        {editing ? (
          <EditPropertyForm
            property={property}
            mutation={updateMutation}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-[var(--sea-ink-soft)]">Name</p>
                <p className="text-[var(--sea-ink)]">{property.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--sea-ink-soft)]">Slug</p>
                <p className="font-mono text-sm text-[var(--sea-ink)]">{property.slug}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--sea-ink-soft)]">Timezone</p>
                <p className="text-[var(--sea-ink)]">{property.timezone}</p>
              </div>
              {property.gbpPlaceId && (
                <div>
                  <p className="text-xs font-medium text-[var(--sea-ink-soft)]">
                    GBP Place ID
                  </p>
                  <p className="font-mono text-sm text-[var(--sea-ink)]">
                    {property.gbpPlaceId}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-[var(--sea-ink-soft)]">Created</p>
                <p className="text-sm text-[var(--sea-ink)]">
                  {new Date(property.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="border-t border-[var(--line)] pt-4">
              <Button variant="outline" onClick={() => navigate({ to: '/properties' })}>
                Back to Properties
              </Button>
            </div>
          </div>
        )}

        {/* Delete — always visible, separate from edit */}
        {!editing && (
          <div className="mt-8 border-t border-[var(--line)] pt-4">
            <h3 className="mb-2 text-sm font-semibold text-red-600">Danger Zone</h3>
            <p className="mb-3 text-sm text-[var(--sea-ink-soft)]">
              This property will be hidden from your organization. Its data will be
              preserved but it will no longer appear in lists.
            </p>
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this property?')) {
                  deleteMutation.mutate()
                }
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Property'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
