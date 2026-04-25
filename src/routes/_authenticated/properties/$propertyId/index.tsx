// Property overview tab — view and edit property details.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getProperty, updateProperty } from '#/contexts/property/server/properties'
import { EditPropertyForm } from '#/components/features/property/EditPropertyForm'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Pencil } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  component: PropertyOverview,
})

function PropertyOverview() {
  const { propertyId } = Route.useParams()
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

  if (!query.data) return null

  const property = query.data

  if (editing) {
    return (
      <EditPropertyForm
        property={property}
        mutation={updateMutation}
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
