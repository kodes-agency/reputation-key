// fallow-ignore-file unused-files — reserved for upcoming phases (property detail fields component)
/**
 * PropertyDetailFields — view property details.
 * Extracted from the property overview route.
 */

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
}>

export function PropertyDetailFields({ property }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Property Details</h2>
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
