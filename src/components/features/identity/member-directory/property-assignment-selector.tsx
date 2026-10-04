import { useState } from 'react'
import { Field, FieldLabel } from '#/components/ui/field'
import { PropertyPicker } from '#/components/property/property-picker'
import { sortPropertiesByName } from '#/components/property/property-search'
import { RemovableChip } from '#/components/ui/removable-chip'

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

/**
 * Which properties an invited member starts with: the chosen ones as removable
 * chips, and the rest behind the app's one in-form property chooser. That is
 * `PropertyPicker`, which gains its search field from eight properties (a longer
 * list is quicker to search than to scan) and has none below it, so this form
 * no longer has a plain Select that a thirty-property organisation had to scroll.
 */
export function PropertyAssignmentSelector({
  field,
  properties,
  onToggleProperty,
  onRemoveProperty,
}: Props) {
  const [open, setOpen] = useState(false)
  const selectedIds = field.state.value
  const availableProperties = sortPropertiesByName(
    properties.filter((p) => !selectedIds.includes(p.id)),
  )

  return (
    <Field>
      <FieldLabel>Assign to properties (optional)</FieldLabel>

      {selectedIds.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedIds.map((pid) => {
            const name = properties.find((p) => p.id === pid)?.name ?? pid
            return (
              <RemovableChip
                key={pid}
                label={name}
                removeLabel={`Remove ${name}`}
                onRemove={() => onRemoveProperty(pid)}
              />
            )
          })}
        </div>
      )}

      {availableProperties.length > 0 && (
        <PropertyPicker
          open={open}
          onOpenChange={setOpen}
          triggerLabel="Add a property…"
          triggerAriaLabel="Add a property"
          heading="Add a property"
          activeValue={null}
          groups={[
            availableProperties.map((property) => ({
              value: property.id,
              label: property.name,
            })),
          ]}
          onSelect={(propertyId) => {
            setOpen(false)
            onToggleProperty(propertyId)
          }}
        />
      )}

      {properties.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No properties yet. The member can be assigned later.
        </p>
      )}
    </Field>
  )
}
