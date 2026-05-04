/**
 * PropertyDetailFields — view and edit property details.
 * Extracted from the property overview route.
 */

import { useState } from 'react'
import { EditPropertyForm } from '../property-form/edit-property-form'
import { Button } from '#/components/ui/button'
import { Pencil } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { useAction } from '#/components/hooks/use-action'

type PropertyData = Readonly<{
  id: string
  name: string
  slug: string
  timezone: string
  gbpPlaceId: string | null
  createdAt: string | Date
}>

type Props = Readonly<{
  property: PropertyData
  updateProperty: (input: {
    data: {
      propertyId: string
      name?: string
      slug?: string
      timezone?: string
      gbpPlaceId?: string | null
    }
  }) => Promise<{ property: PropertyData }>
}>

export function PropertyDetailFields({ property, updateProperty }: Props) {
  const [editing, setEditing] = useState(false)

  const updatePropertyAction = useAction(updateProperty)
  const updateMutation = useMutationAction(updatePropertyAction, {
    successMessage: 'Property updated',
    onSuccess: async () => {
      setEditing(false)
    },
  })

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

      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
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
      </div>
    </div>
  )
}

function DetailField({
  label,
  value,
  mono,
}: Readonly<{
  label: string
  value: string
  mono?: boolean
}>) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-sm' : ''}>{value}</p>
    </div>
  )
}
