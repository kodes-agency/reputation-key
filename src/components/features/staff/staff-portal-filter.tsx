import { useNavigate } from '@tanstack/react-router'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { StaffPortalEntry } from '#/contexts/staff/server/staff-portals'

type StaffPortalFilterProps = Readonly<{
  portals: readonly StaffPortalEntry[]
  activePortalId: string | undefined
  searchPropertyId: string | undefined
}>

export function StaffPortalFilter({
  portals,
  activePortalId,
  searchPropertyId,
}: StaffPortalFilterProps) {
  const navigate = useNavigate()

  if (portals.length === 0) return null

  return (
    <Select
      value={activePortalId ?? '__all__'}
      onValueChange={(value) => {
        navigate({
          to: '/home',
          search: {
            propertyId: searchPropertyId,
            portalId: value === '__all__' ? undefined : value,
          },
          replace: true,
        })
      }}
    >
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="All portals" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All portals</SelectItem>
        {portals.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
