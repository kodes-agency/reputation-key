// Property filter dropdown — presentational.
// Receives the property list as a prop (threaded from the route loader per
// src/components/CONTEXT.md). Never fetches server data directly.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

type Props = Readonly<{
  value: string | undefined
  onChange: (propertyId: string | undefined) => void
  className?: string
  properties: ReadonlyArray<{ id: string; name: string }>
}>

export function PropertyFilterSelect({ value, onChange, className, properties }: Props) {
  if (properties.length <= 1) return null

  return (
    <Select
      value={value ?? 'all'}
      onValueChange={(v) => onChange(v === 'all' ? undefined : v)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Filter by property"
        className={className ?? 'w-[150px]'}
      >
        <SelectValue placeholder="All properties" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All properties</SelectItem>
        {properties.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
