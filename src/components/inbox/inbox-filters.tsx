// Server import exception: loads property list for filter dropdown client-side.
// Parent route doesn't provide properties data; prop drilling would require
// route loader changes in multiple parent routes for a single dropdown.
/* eslint-disable max-lines */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Input } from '#/components/ui/input'
import { Filter } from 'lucide-react'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { listProperties } from '#/contexts/property/server/properties'
import type { InboxStatus, SourceType } from '#/contexts/inbox/application/public-api'

export type InboxFilterValues = Readonly<{
  propertyId: string | undefined
  status: InboxStatus | undefined
  sourceType: SourceType | undefined
  platform: string | undefined
  ratingMin: number | undefined
  ratingMax: number | undefined
}>

type Props = Readonly<{
  value: InboxFilterValues
  onChange: (filters: InboxFilterValues) => void
}>

const statuses: Array<{ value: InboxStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'addressed', label: 'Addressed' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'archived', label: 'Archived' },
]

const sourceTypes: Array<{ value: SourceType; label: string }> = [
  { value: 'review', label: 'Review' },
  { value: 'feedback', label: 'Feedback' },
]

const platforms = [{ value: 'google', label: 'Google' }]

export function InboxFilters({ value, onChange }: Props) {
  const update = (patch: Partial<InboxFilterValues>) => {
    onChange({ ...value, ...patch })
  }

  // Fetch properties for the filter dropdown (role-scoped by the server)
  const [properties, setProperties] = useState<
    ReadonlyArray<{ id: string; name: string }>
  >([])
  const [propertiesError, setPropertiesError] = useState(false)
  const propertyAction = useAction(useServerFn(listProperties))
  const propAbortRef = useRef(false)

  // Keep action ref current to avoid stale closures
  const propertyActionRef = useRef(propertyAction)
  propertyActionRef.current = propertyAction

  const loadProperties = useCallback(async () => {
    propAbortRef.current = false
    try {
      const result = await propertyActionRef.current({ data: undefined })
      if (!propAbortRef.current && result?.properties) {
        setProperties(
          result.properties.map((p: { id: string; name: string }) => ({
            id: p.id,
            name: p.name,
          })),
        )
      }
    } catch {
      setPropertiesError(true)
    }
  }, [])

  useEffect(() => {
    loadProperties()
    return () => {
      propAbortRef.current = true
    }
  }, [loadProperties])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Filter className="size-4 text-muted-foreground" />

      {propertiesError && (
        <span className="text-xs text-muted-foreground">Properties unavailable</span>
      )}

      {properties.length > 1 && (
        <Select
          value={value.propertyId ?? 'all'}
          onValueChange={(v) => update({ propertyId: v === 'all' ? undefined : v })}
        >
          <SelectTrigger size="sm" className="w-[150px]">
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
      )}

      <Select
        value={value.status ?? 'all'}
        onValueChange={(v) =>
          update({ status: v === 'all' ? undefined : (v as InboxStatus) })
        }
      >
        <SelectTrigger size="sm" className="w-[130px]">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.sourceType ?? 'all'}
        onValueChange={(v) =>
          update({ sourceType: v === 'all' ? undefined : (v as SourceType) })
        }
      >
        <SelectTrigger size="sm" className="w-[130px]">
          <SelectValue placeholder="All sources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {sourceTypes.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.platform ?? 'all'}
        onValueChange={(v) => update({ platform: v === 'all' ? undefined : v })}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue placeholder="All platforms" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All platforms</SelectItem>
          {platforms.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          placeholder="Min ★"
          min={1}
          max={5}
          className="h-8 w-[72px] text-sm"
          value={value.ratingMin ?? ''}
          onChange={(e) =>
            update({ ratingMin: e.target.value ? Number(e.target.value) : undefined })
          }
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          placeholder="Max ★"
          min={1}
          max={5}
          className="h-8 w-[72px] text-sm"
          value={value.ratingMax ?? ''}
          onChange={(e) =>
            update({ ratingMax: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </div>
    </div>
  )
}
