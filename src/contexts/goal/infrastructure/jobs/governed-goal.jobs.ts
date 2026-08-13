import type {
  GoalExecutionPolicy,
  GovernedGoalService,
} from '../../application/use-cases/governed-goals'
import type { GovernedGoalRepository } from '../../application/ports/governed-goal.repository'
import type { GovernedReading } from '../../domain/governed-goal'

export type GoalAggregateReader = Readonly<{
  read(
    input: Readonly<{
      organizationId: string
      propertyId: string
      definitionId: string
      definitionVersionId: string
      periodStart: Date
      periodEnd: Date
    }>,
  ): Promise<Readonly<{ reading: GovernedReading | null; watermark: Date }>>
}>

export async function runGovernedGoalCloseSchedule(
  input: Readonly<{
    repository: GovernedGoalRepository
    policy: GoalExecutionPolicy
    service: GovernedGoalService
    aggregates: GoalAggregateReader
    now: Date
  }>,
): Promise<Readonly<{ closed: number; denied: number; failed: number }>> {
  // This first query is intentionally content-free and tenant-cross. Every target
  // is re-authorized below before a period, version, or metric aggregate is read.
  const scopes = await input.repository.enumerateDueScopes(input.now)
  let closed = 0
  let denied = 0
  let failed = 0
  for (const scope of scopes) {
    try {
      await input.policy.authorize({
        actor: 'system',
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        action: 'goal.update',
      })
    } catch {
      denied++
      continue
    }
    try {
      const periods = await input.repository.listOpenPeriods(
        scope.organizationId,
        scope.propertyId,
        scope.definitionId,
        new Date(0),
      )
      for (const period of periods) {
        if (period.periodEnd > input.now || period.status === 'closed') continue
        const aggregate = await input.aggregates.read({
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          definitionId: scope.definitionId,
          definitionVersionId: period.definitionVersionId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        })
        await input.service.evaluate({
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          periodId: period.id,
          sourceEventId: `goal-period-close:${period.id}:${period.periodEnd.toISOString()}`,
          reading: aggregate.reading,
          watermark: aggregate.watermark,
          closePeriod: true,
        })
        closed++
      }
    } catch {
      failed++
    }
  }
  return { closed, denied, failed }
}

export async function refreshGovernedGoalsFromReading(
  input: Readonly<{
    repository: GovernedGoalRepository
    policy: GoalExecutionPolicy
    service: GovernedGoalService
    organizationId: string
    propertyId: string
    sourceEventId: string
    reading: GovernedReading
    watermark: Date
  }>,
): Promise<Readonly<{ evaluated: number; denied: boolean }>> {
  try {
    await input.policy.authorize({
      actor: 'system',
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: 'goal.update',
    })
  } catch {
    return { evaluated: 0, denied: true }
  }

  const scopes = await input.repository.enumerateActiveScopesForProperty(
    input.organizationId,
    input.propertyId,
  )
  let evaluated = 0
  for (const scope of scopes) {
    const version = await input.repository.getCurrentVersion(
      scope.organizationId,
      scope.propertyId,
      scope.definitionId,
    )
    if (!version || version.metric.versionId !== input.reading.definitionVersionId) {
      continue
    }
    const periods = await input.repository.listOpenPeriods(
      scope.organizationId,
      scope.propertyId,
      scope.definitionId,
      input.reading.eventAt ?? input.watermark,
    )
    const eventAt = input.reading.eventAt ?? input.watermark
    for (const period of periods) {
      if (eventAt < period.periodStart || eventAt >= period.periodEnd) continue
      await input.service.evaluate({
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        periodId: period.id,
        sourceEventId: input.sourceEventId,
        reading: input.reading,
        watermark: input.watermark,
      })
      evaluated++
    }
  }
  return { evaluated, denied: false }
}
