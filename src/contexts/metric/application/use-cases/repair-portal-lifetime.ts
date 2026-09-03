import type { PortalLifetimeValues } from '../../domain/portal-lifetime-aggregate'
import type {
  PortalLifetimeAggregatePort,
  PortalLifetimeScope,
} from '../ports/portal-lifetime-aggregate.port'

export type RepairPortalLifetimeInput = Readonly<{
  scope: PortalLifetimeScope
  mode: 'report' | 'apply'
}>

export type RepairPortalLifetimeResult = Readonly<{
  mode: 'report' | 'apply'
  matchedBefore: boolean
  changed: boolean
  projectionRevision: number
  currentValues: PortalLifetimeValues
  expectedValues: PortalLifetimeValues
}>

export async function repairPortalLifetime(
  deps: Readonly<{ lifetime: PortalLifetimeAggregatePort }>,
  input: RepairPortalLifetimeInput,
): Promise<RepairPortalLifetimeResult> {
  if (input.mode === 'report') {
    const inspection = await deps.lifetime.inspect(input.scope)
    return {
      mode: 'report',
      matchedBefore: inspection.matched,
      changed: false,
      projectionRevision: inspection.current.projectionRevision,
      currentValues: inspection.current.values,
      expectedValues: inspection.expectedValues,
    }
  }

  const reconciliation = await deps.lifetime.rebuild(input.scope)
  return {
    mode: 'apply',
    matchedBefore: reconciliation.matched,
    changed: !reconciliation.matched,
    projectionRevision: reconciliation.after.projectionRevision,
    currentValues: reconciliation.before?.values ?? reconciliation.after.values,
    expectedValues: reconciliation.after.values,
  }
}
