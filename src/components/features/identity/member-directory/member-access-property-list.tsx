// The Manage access checklist: every property in the Organization with a
// checkbox for access and, where it maps to the property's Responsible
// managers, a switch for the member's responsibility. Search and Select all
// work on the properties currently listed.

import { useId, useState } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import type { PropertyRef } from './member-table'
import { selectAllVisible, toggleId } from './member-access-diff'

type Props = Readonly<{
  properties: ReadonlyArray<PropertyRef>
  selectedIds: ReadonlyArray<string>
  responsibleIds: ReadonlyArray<string>
  /** False hides the switches: responsibility could not be read. */
  showResponsibility: boolean
  disabled: boolean
  onSelectedChange: (ids: string[]) => void
  onResponsibleChange: (ids: string[]) => void
}>

function matches(property: PropertyRef, query: string): boolean {
  return property.name.toLowerCase().includes(query.trim().toLowerCase())
}

export function MemberAccessPropertyList({
  properties,
  selectedIds,
  responsibleIds,
  showResponsibility,
  disabled,
  onSelectedChange,
  onResponsibleChange,
}: Props) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const visible = properties.filter((property) => matches(property, query))
  const visibleIds = visible.map((property) => property.id)
  const visibleSelected = visibleIds.filter((id) => selectedIds.includes(id))
  const allVisibleSelected =
    visibleIds.length > 0 && visibleSelected.length === visibleIds.length

  if (properties.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No properties yet. Import a property first, then give this manager access.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor={searchId} className="sr-only">
          Search properties
        </Label>
        <Input
          id={searchId}
          type="search"
          placeholder="Search properties"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="flex items-center gap-2 border-b pb-2">
        <Checkbox
          id={`${searchId}-all`}
          checked={
            allVisibleSelected
              ? true
              : visibleSelected.length > 0
                ? 'indeterminate'
                : false
          }
          disabled={disabled || visibleIds.length === 0}
          onCheckedChange={() =>
            onSelectedChange(
              selectAllVisible(selectedIds, visibleIds, !allVisibleSelected),
            )
          }
        />
        <Label htmlFor={`${searchId}-all`} className="font-normal">
          {query.trim() ? 'Select all matching' : 'Select all'}
        </Label>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No property matches "{query.trim()}".
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {visible.map((property) => {
            const isSelected = selectedIds.includes(property.id)
            const checkboxId = `${searchId}-${property.id}`
            return (
              <li key={property.id} className="flex items-center gap-3 py-2">
                <Checkbox
                  id={checkboxId}
                  checked={isSelected}
                  disabled={disabled}
                  onCheckedChange={() =>
                    onSelectedChange(toggleId(selectedIds, property.id))
                  }
                />
                <Label htmlFor={checkboxId} className="flex-1 font-normal">
                  {property.name}
                </Label>
                {showResponsibility && isSelected ? (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`${checkboxId}-responsible`}
                      className="text-xs font-normal text-muted-foreground"
                    >
                      Responsible
                    </Label>
                    <Switch
                      id={`${checkboxId}-responsible`}
                      size="sm"
                      aria-label={`Responsible for ${property.name}`}
                      checked={responsibleIds.includes(property.id)}
                      disabled={disabled}
                      onCheckedChange={() =>
                        onResponsibleChange(toggleId(responsibleIds, property.id))
                      }
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {showResponsibility ? (
        <p className="text-xs text-muted-foreground">
          "Responsible" means they get that property's review, feedback and health
          updates.
        </p>
      ) : null}
    </div>
  )
}
