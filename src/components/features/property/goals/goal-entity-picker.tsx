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
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { EntityScope } from '#/shared/domain/metric-keys'
import type { PortalOption } from './goal-entity-types'

// The portal and portal-group branches were the same shape written twice — an
// empty state and a select, differing only in label, placeholder and options.
// Sharing them is what brings this component under the cognitive gate; it also
// removes the clone group the duplication check reported.

function EntitySelect({
  label,
  placeholder,
  options,
  entityId,
  error,
  onChange,
}: {
  label: string
  placeholder: string
  options: readonly PortalOption[]
  entityId: string
  error: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={entityId} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </Field>
  )
}

function EmptyEntityNotice({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <p className="text-sm text-muted-foreground">{children}</p>
    </Field>
  )
}

/**
 * `/portals/new` gates on portal.write and the create server fn asserts
 * portal.create; offering the link without both routes the user straight to
 * /unavailable. UI affordance only — both gates stay in place (ADR 0049).
 */
function NoPortalsNotice({ propertyId }: { propertyId: string }) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  if (!(can('portal.create') && has('portal.write'))) {
    return (
      <EmptyEntityNotice label="Portal">
        No portals created yet. A portal is required to set portal-scoped goals.
      </EmptyEntityNotice>
    )
  }
  return (
    <EmptyEntityNotice label="Portal">
      No portals created yet.{' '}
      <Link
        to="/properties/$propertyId/portals/new"
        params={{ propertyId }}
        className="inline-flex items-center gap-1 text-sm font-medium text-link underline-offset-4 hover:underline"
      >
        <Plus className="size-3" />
        Create a portal
      </Link>{' '}
      to set portal-scoped goals.
    </EmptyEntityNotice>
  )
}

export function EntityPicker({
  entityScope,
  entityId,
  setters,
  errors,
  portals,
  portalGroups,
  propertyId,
}: {
  entityScope: EntityScope
  entityId: string
  setters: Record<string, (v: string) => void>
  errors: Record<string, string>
  portals: readonly PortalOption[]
  portalGroups: readonly PortalOption[]
  propertyId: string
}) {
  if (entityScope === 'portal') {
    if (portals.length === 0) return <NoPortalsNotice propertyId={propertyId} />
    return (
      <EntitySelect
        label="Portal"
        placeholder="Select a portal"
        options={portals}
        entityId={entityId}
        error={errors.entityId}
        onChange={(v) => setters.entityId(v)}
      />
    )
  }

  if (entityScope === 'portal_group') {
    if (portalGroups.length === 0) {
      return (
        <EmptyEntityNotice label="Portal Group">
          No portal groups created yet. Create a portal group to set group-scoped goals.
        </EmptyEntityNotice>
      )
    }
    return (
      <EntitySelect
        label="Portal Group"
        placeholder="Select a portal group"
        options={portalGroups}
        entityId={entityId}
        error={errors.entityId}
        onChange={(v) => setters.entityId(v)}
      />
    )
  }

  return null
}
