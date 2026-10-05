import { useEffect, useId, useRef, useState } from 'react'
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
 * Where focus goes once the control that held it has left the form: removing a chip
 * unmounts the button that was pressed, and choosing the last property unmounts the
 * picker's trigger. Either would drop the keyboard to the page, so it is handed on.
 * The choice may land a render after the press, so the hand-off waits for it.
 */
type Handoff =
  | Readonly<{ kind: 'removed'; id: string; index: number }>
  | Readonly<{ kind: 'added'; id: string }>

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
  const labelId = useId()
  const triggerId = useId()
  const chipsRef = useRef<HTMLDivElement>(null)
  const handoff = useRef<Handoff | null>(null)
  const selectedIds = field.state.value
  const availableProperties = sortPropertiesByName(
    properties.filter((p) => !selectedIds.includes(p.id)),
  )

  // After every render, because the choice may land in a later one: act only once it has.
  useEffect(() => {
    const pending = handoff.current
    if (pending === null) return
    if (selectedIds.includes(pending.id) !== (pending.kind === 'added')) return
    handoff.current = null
    const chips = Array.from(
      chipsRef.current?.querySelectorAll<HTMLElement>('[data-slot="removable-chip"]') ??
        [],
    )
    const trigger = document.getElementById(triggerId)
    if (pending.kind === 'removed') {
      // The chip that took its place, else the one before it, else the picker, which
      // offers the property just taken back.
      const index = Math.min(pending.index, chips.length - 1)
      ;(chips[index] ?? trigger)?.focus()
    } else if (trigger === null) {
      // The last property was chosen, so the picker is gone: the new chip is next.
      chips.at(-1)?.focus()
    }
  })

  return (
    // The label names the group of chips and picker: it labels no single control.
    <Field aria-labelledby={labelId}>
      <FieldLabel id={labelId} optional>
        Assign to properties
      </FieldLabel>

      {selectedIds.length > 0 && (
        <div ref={chipsRef} className="mb-2 flex flex-wrap gap-1.5">
          {selectedIds.map((pid, index) => {
            const name = properties.find((p) => p.id === pid)?.name ?? pid
            return (
              <RemovableChip
                key={pid}
                label={name}
                removeLabel={`Remove ${name}`}
                onRemove={() => {
                  handoff.current = { kind: 'removed', id: pid, index }
                  onRemoveProperty(pid)
                }}
              />
            )
          })}
        </div>
      )}

      {availableProperties.length > 0 && (
        <PropertyPicker
          open={open}
          onOpenChange={setOpen}
          triggerId={triggerId}
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
            handoff.current = { kind: 'added', id: propertyId }
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
