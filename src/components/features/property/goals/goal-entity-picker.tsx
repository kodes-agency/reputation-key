import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { EntityScope } from '#/shared/domain/metric-keys'
import type { PortalOption, TeamOption, StaffOption } from './goal-entity-types'

export function EntityPicker({
  entityScope,
  entityId,
  setters,
  errors,
  portals,
  teams,
  _staffAssignments,
  propertyId,
}: {
  entityScope: EntityScope
  entityId: string
  setters: Record<string, (v: string) => void>
  errors: Record<string, string>
  portals: readonly PortalOption[]
  teams: readonly TeamOption[]
  staffAssignments: readonly StaffOption[]
  propertyId: string
}) {
  if (entityScope === 'portal') {
    return portals.length === 0 ? (
      <Field>
        <FieldLabel>Portal</FieldLabel>
        <p className="text-sm text-muted-foreground">
          No portals created yet.{' '}
          <Link
            to="/properties/$propertyId/portals/new"
            params={{ propertyId }}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            <Plus className="size-3" />
            Create a portal
          </Link>{' '}
          to set portal-scoped goals.
        </p>
      </Field>
    ) : (
      <Field>
        <FieldLabel>Portal</FieldLabel>
        <Select value={entityId} onValueChange={(v) => setters.entityId(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a portal" />
          </SelectTrigger>
          <SelectContent>
            {portals.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.entityId && (
          <span className="text-sm text-destructive">{errors.entityId}</span>
        )}
      </Field>
    )
  }

  if (entityScope === 'portal_group') {
    return teams.length === 0 ? (
      <Field>
        <FieldLabel>Team</FieldLabel>
        <p className="text-sm text-muted-foreground">
          No teams created yet. Create a team on the{' '}
          <Link
            to="/properties/$propertyId/people"
            params={{ propertyId }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            People
          </Link>{' '}
          page to set team-scoped goals.
        </p>
      </Field>
    ) : (
      <Field>
        <FieldLabel>Team</FieldLabel>
        <Select value={entityId} onValueChange={(v) => setters.entityId(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.entityId && (
          <span className="text-sm text-destructive">{errors.entityId}</span>
        )}
      </Field>
    )
  }

  return null
}
