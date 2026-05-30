// Property filter dropdown — self-loading, role-scoped by the server.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { listProperties } from '#/contexts/property/server/properties'

type Props = Readonly<{
  value: string | undefined
  onChange: (propertyId: string | undefined) => void
}>

export function PropertyFilterSelect({ value, onChange }: Props) {
  const [properties, setProperties] = useState<
    ReadonlyArray<{ id: string; name: string }>
  >([])
  const [error, setError] = useState(false)
  const propertyAction = useAction(useServerFn(listProperties))
  const abortRef = useRef(false)
  const actionRef = useRef(propertyAction)
  actionRef.current = propertyAction

  const loadProperties = useCallback(async () => {
    abortRef.current = false
    try {
      const result = await actionRef.current({ data: undefined })
      if (!abortRef.current && result?.properties) {
        setProperties(
          result.properties.map((p: { id: string; name: string }) => ({
            id: p.id,
            name: p.name,
          })),
        )
      }
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    loadProperties()
    return () => {
      abortRef.current = true
    }
  }, [loadProperties])

  if (error) {
    return (
      <span className="text-xs text-muted-foreground">Properties unavailable</span>
    )
  }

  if (properties.length <= 1) return null

  return (
    <Select
      value={value ?? 'all'}
      onValueChange={(v) => onChange(v === 'all' ? undefined : v)}
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
  )
}
