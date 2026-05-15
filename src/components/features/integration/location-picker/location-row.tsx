import type { GbpLocation } from '#/contexts/integration/application/public-api'
import { Checkbox } from '#/components/ui/checkbox'
import { Badge } from '#/components/ui/badge'

type Props = Readonly<{
  location: GbpLocation
  selected: boolean
  onSelect: (selected: boolean) => void
}>

export function LocationRow({ location, selected, onSelect }: Props) {
  return (
    <label className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent cursor-pointer">
      <Checkbox
        checked={selected}
        onCheckedChange={onSelect}
        className="mt-0.5"
        aria-label={`Select ${location.businessName}`}
      />
      <div className="flex-1 space-y-1">
        <p className="font-medium">{location.businessName}</p>
        {location.address && (
          <p className="text-sm text-muted-foreground">{location.address}</p>
        )}
        {location.primaryCategory && (
          <Badge variant="secondary" className="w-fit">
            {location.primaryCategory}
          </Badge>
        )}
      </div>
    </label>
  )
}
