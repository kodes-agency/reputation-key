// Property overview tab — view and edit property details.

import { createFileRoute, useRouter, getRouteApi } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { updateProperty } from '#/contexts/property/server/properties'
import { EditPropertyForm } from '#/components/features/property/EditPropertyForm'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Pencil } from 'lucide-react'
import { useAction, wrapAction } from '#/components/hooks/use-action'

const parentRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  component: PropertyOverview,
})

function PropertyOverview() {
  const router = useRouter()
  const { property } = parentRoute.useLoaderData()
  const [editing, setEditing] = useState(false)

  const updatePropertyFn = useAction(useServerFn(updateProperty))

  const mutation = wrapAction(updatePropertyFn, async () => {
    setEditing(false)
    await router.invalidate()
  })

  if (!property) return null

  if (editing) {
    return (
      <EditPropertyForm
        property={property}
        mutation={mutation}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Property Details</h2>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-4">
          <DetailField label="Name" value={property.name} />
          <DetailField label="Slug" value={property.slug} mono />
          <DetailField label="Timezone" value={property.timezone} />
          {property.gbpPlaceId && (
            <DetailField label="GBP Place ID" value={property.gbpPlaceId} mono />
          )}
          <DetailField
            label="Created"
            value={new Date(property.createdAt).toLocaleDateString()}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-sm' : ''}>{value}</p>
    </div>
  )
}
