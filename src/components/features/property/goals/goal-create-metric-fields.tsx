// Goal create form — entity picker, metric key & aggregation selects
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
import { aggregationLabel } from '#/contexts/goal/ui/helpers'
import type { AggregationFunction, EntityScope } from '#/shared/domain/metric-keys'
import type { Portal } from '#/contexts/portal/domain/types'
import type { Team } from '#/contexts/team/domain/types'
import type { StaffAssignment } from '#/contexts/staff/domain/types'

type MetricFieldsProps = Readonly<{
  showEntityPicker: boolean
  entityScope: EntityScope
  entityId: string
  metricKey: string
  aggregation: AggregationFunction
  errors: Record<string, string>
  setters: Record<string, (v: string) => void>
  availableMetrics: readonly string[]
  availableAggregations: readonly string[]
  portals: readonly Portal[]
  teams: readonly Team[]
  staffAssignments: readonly StaffAssignment[]
  propertyId: string
}>

function EntityPicker({
  entityScope,
  entityId,
  setters,
  errors,
  portals,
  teams,
  staffAssignments,
  propertyId,
}: {
  entityScope: EntityScope
  entityId: string
  setters: Record<string, (v: string) => void>
  errors: Record<string, string>
  portals: readonly Portal[]
  teams: readonly Team[]
  staffAssignments: readonly StaffAssignment[]
  propertyId: string
}) {
  if (entityScope === 'portal') {
    if (portals.length === 0) {
      return (
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
      )
    }
    return (
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

  if (entityScope === 'team') {
    if (teams.length === 0) {
      return (
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
      )
    }
    return (
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

  if (entityScope === 'staff') {
    if (staffAssignments.length === 0) {
      return (
        <Field>
          <FieldLabel>Staff Member</FieldLabel>
          <p className="text-sm text-muted-foreground">
            No staff assigned yet. Assign staff on the{' '}
            <Link
              to="/properties/$propertyId/people"
              params={{ propertyId }}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              People
            </Link>{' '}
            page to set staff-scoped goals.
          </p>
        </Field>
      )
    }
    return (
      <Field>
        <FieldLabel>Staff Member</FieldLabel>
        <Select value={entityId} onValueChange={(v) => setters.entityId(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a staff member" />
          </SelectTrigger>
          <SelectContent>
            {staffAssignments.map((a) => (
              <SelectItem key={a.id} value={a.userId}>
                {a.userId}
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

export function GoalMetricFields({
  showEntityPicker,
  entityScope,
  entityId,
  metricKey,
  aggregation,
  errors,
  setters: $,
  availableMetrics,
  availableAggregations,
  portals,
  teams,
  staffAssignments,
  propertyId,
}: MetricFieldsProps) {
  return (
    <>
      {showEntityPicker && (
        <EntityPicker
          entityScope={entityScope}
          entityId={entityId}
          setters={$}
          errors={errors}
          portals={portals}
          teams={teams}
          staffAssignments={staffAssignments}
          propertyId={propertyId}
        />
      )}
      <Field>
        <FieldLabel>Metric Key</FieldLabel>
        <Select value={metricKey} onValueChange={$.metricKey}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a metric" />
          </SelectTrigger>
          <SelectContent>
            {availableMetrics.map((key: string) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.metricKey && (
          <span className="text-sm text-destructive">{errors.metricKey}</span>
        )}
      </Field>
      <Field>
        <FieldLabel>Aggregation</FieldLabel>
        <Select
          value={aggregation}
          onValueChange={(v) => $.aggregation(v)}
          disabled={!metricKey}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={metricKey ? 'Select aggregation' : 'Select a metric first'}
            />
          </SelectTrigger>
          <SelectContent>
            {availableAggregations.map((agg: string) => (
              <SelectItem key={agg} value={agg}>
                {aggregationLabel(agg as AggregationFunction)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}
