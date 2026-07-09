import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Badge } from '#/components/ui/badge'
import { X } from 'lucide-react'

type PropertyOption = Readonly<{
  id: string
  name: string
}>

type Props = Readonly<{
  field: {
    state: {
      value: string[]
    }
  }
  properties: ReadonlyArray<PropertyOption>
  onToggleProperty: (propertyId: string) => void
  onRemoveProperty: (propertyId: string) => void
}>

export function PropertyAssignmentSelector({
  field,
  properties,
  onToggleProperty,
  onRemoveProperty,
}: Props) {
  const selectedIds = field.state.value
  const availableProperties = properties.filter((p) => !selectedIds.includes(p.id))

  return (
    <Field>
      <FieldLabel>Assign to properties (optional)</FieldLabel>

      {/* Selected properties as removable badges */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedIds.map((pid) => {
            const prop = properties.find((p) => p.id === pid)
            return (
              <Badge key={pid} variant="secondary" className="gap-1 pr-1">
                {prop?.name ?? pid}
                <button
                  type="button"
                  onClick={() => onRemoveProperty(pid)}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                  aria-label={`Remove ${prop?.name ?? pid}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
        </div>
      )}

      {/* Add property dropdown */}
      {availableProperties.length > 0 && (
        <Select onValueChange={onToggleProperty}>
          <SelectTrigger aria-label="Add a property">
            <SelectValue placeholder="Add a property…" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {availableProperties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {properties.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No properties yet. The member can be assigned later.
        </p>
      )}
    </Field>
  )
}
