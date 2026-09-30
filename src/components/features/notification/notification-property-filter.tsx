// The /notifications page's Property filter (docs/design/notifications,
// direction B): a manager of many properties reads one Property's notices at a
// time. The Inbox's searchable select (#582), with "All properties" first.
//
// Offered only to a reader with more than one Property; the rows name their
// Property either way.

import { useState } from 'react'
import { PropertyPicker } from '#/components/property/property-picker'

/** The picker's value for "no filter": never a Property id (those are UUIDs). */
const ALL_PROPERTIES = 'all-properties'

/**
 * Whether the page offers — and so honours — a Property filter. A filter the
 * reader cannot see must not apply: a stale `?property=` for a reader with one
 * Property would hide their Organization notices with nothing to clear it.
 */
export const offersPropertyFilter = (properties: ReadonlyArray<unknown>): boolean =>
  properties.length > 1

type Props = Readonly<{
  properties: ReadonlyArray<Readonly<{ id: string; name: string }>>
  /** The Property the page is filtered to, or null for all of them. */
  propertyId: string | null
  onChange: (propertyId: string | null) => void
}>

export function NotificationPropertyFilter({ properties, propertyId, onChange }: Props) {
  const [open, setOpen] = useState(false)
  if (!offersPropertyFilter(properties)) return null
  const selected = properties.find((property) => property.id === propertyId)
  const label = selected?.name ?? 'All properties'
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      triggerLabel={label}
      triggerAriaLabel={`Property: ${label}`}
      heading="Show notifications for"
      activeValue={selected?.id ?? ALL_PROPERTIES}
      groups={[
        [{ value: ALL_PROPERTIES, label: 'All properties' }],
        properties.map((property) => ({ value: property.id, label: property.name })),
      ]}
      onSelect={(value) => {
        setOpen(false)
        onChange(value === ALL_PROPERTIES ? null : value)
      }}
      className="w-full sm:w-72"
    />
  )
}
