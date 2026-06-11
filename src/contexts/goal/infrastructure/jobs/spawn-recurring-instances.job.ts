// Goal context — spawn-recurring-instances job
// Finds active recurring templates and spawns the next instance when
// the next period start is within 1 day of NOW().

import type { Job } from 'bullmq'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { GoalProgress, RecurrenceFrequency } from '../../domain/types'
import { buildGoal } from '../../domain/constructors'
import { goalId, goalProgressId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

// ── Job name ──────────────────────────────────────────────────────────────

export const SPAWN_RECURRING_JOB_NAME = 'spawn-recurring-instances' as const

// ── Deps ──────────────────────────────────────────────────────────────────

export type SpawnRecurringInstancesDeps = Readonly<{
  goalRepo: GoalRepository
  events: EventBus
  clock: () => Date
  idGen: () => string
}>

// ── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ── Handler factory ───────────────────────────────────────────────────────

export const createSpawnRecurringInstancesHandler =
  (deps: SpawnRecurringInstancesDeps) =>
  async (_job: Job): Promise<SpawnSummary> => {
    return trace('job.spawnRecurringInstances', async () => {
      const logger = getLogger()
      const now = deps.clock()

      // ⚠️ CROSS-TENANT by design — background job processes all orgs
      const recurringTemplates = await deps.goalRepo.findAllActiveRecurring()

      let spawned = 0
      let failed = 0

      for (const template of recurringTemplates) {
        try {
          const rule = template.recurrenceRule
          if (!rule) continue

          // Find latest instance for this template
          const latest = await deps.goalRepo.findLatestInstance(
            template.id,
            template.organizationId,
          )

          let nextStart: Date
          if (latest?.periodEnd) {
            nextStart = computeNextPeriodStart(latest.periodEnd, rule.frequency)
          } else {
            // New template — first instance starts from template creation date
            nextStart = computeNextPeriodStart(template.createdAt, rule.frequency)
          }

          const nextEnd = computePeriodEnd(nextStart, rule.frequency)

          // Only spawn if next start is within 1 day of NOW()
          if (Math.abs(nextStart.getTime() - now.getTime()) > MS_PER_DAY) {
            continue
          }

          // Build the instance via domain constructor
          const instanceResult = buildGoal({
            id: goalId(deps.idGen()),
            organizationId: template.organizationId,
            propertyId: template.propertyId,
            portalId: template.portalId,
            portalGroupId: template.portalGroupId,
            name: template.name,
            description: template.description,
            createdBy: template.createdBy,
            goalType: 'recurring',
            aggregationFunction: template.aggregationFunction,
            metricKey: template.metricKey,
            targetValue: template.targetValue,
            periodStart: nextStart,
            periodEnd: nextEnd,
            recurrenceRule: template.recurrenceRule,
            parentGoalId: template.id,
            now,
          })

          if (instanceResult.isErr()) {
            logger.warn(
              { templateId: template.id as string, error: instanceResult.error },
              'Failed to build recurring instance — skipping',
            )
            continue
          }

          const instance = instanceResult.value

          // Guard against race condition: check if instance already exists for this period
          // TODO: Replace with a unique DB constraint on (parentGoalId, periodStart) for correctness
          const instances = await deps.goalRepo.listInstances(
            template.id,
            template.organizationId,
          )
          const duplicate = instances.some(
            (inst) =>
              inst.periodStart &&
              Math.abs(inst.periodStart.getTime() - nextStart.getTime()) < 1000,
          )
          if (duplicate) {
            logger.info(
              { templateId: template.id },
              'Instance already exists for this period — skipping',
            )
            continue
          }

          // Create initial progress
          const progress: GoalProgress = {
            id: goalProgressId(deps.idGen()),
            goalId: instance.id,
            organizationId: instance.organizationId,
            currentValue: 0,
            currentSum: null,
            currentCount: null,
            lastComputedAt: now,
            computedSource: 'event_increment',
          }

          await deps.goalRepo.createGoalAndProgress(instance, progress)
          spawned++
        } catch (err) {
          logger.error(
            { err, templateId: template.id },
            'goal: error spawning recurring instance — skipping',
          )
          failed++
          continue
        }
      }

      const summary: SpawnSummary = {
        templatesChecked: recurringTemplates.length,
        spawned,
        failed,
      }

      logger.info(summary, 'Spawned recurring instances')
      return summary
    })
  }

// ── Summary type ──────────────────────────────────────────────────────────

export type SpawnSummary = Readonly<{
  templatesChecked: number
  spawned: number
  failed: number
}>

// ── Calendar period helpers ───────────────────────────────────────────────

/**
 * Compute the next period start based on the latest instance's periodEnd
 * and the recurrence frequency.
 *
 * weekly: next Monday after periodEnd
 * monthly: first day of next month after periodEnd
 * quarterly: first day of next quarter after periodEnd
 */
export function computeNextPeriodStart(
  latestPeriodEnd: Date,
  frequency: RecurrenceFrequency,
): Date {
  switch (frequency) {
    case 'weekly':
      return nextMonday(latestPeriodEnd)
    case 'monthly':
      return firstOfNextMonth(latestPeriodEnd)
    case 'quarterly':
      return firstOfNextQuarter(latestPeriodEnd)
  }
}

/**
 * Compute the period end for a given period start and frequency.
 *
 * weekly: start + 6 days (end of Sunday)
 * monthly: last day of the month
 * quarterly: last day of the quarter
 */
export function computePeriodEnd(start: Date, frequency: RecurrenceFrequency): Date {
  switch (frequency) {
    case 'weekly': {
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 6)
      end.setUTCHours(23, 59, 59, 999)
      return end
    }
    case 'monthly': {
      // Last day of the start's month
      const end = new Date(start)
      end.setUTCMonth(end.getUTCMonth() + 1, 0) // day 0 = last day of prev month
      end.setUTCHours(23, 59, 59, 999)
      return end
    }
    case 'quarterly': {
      // Last day of the quarter
      const end = new Date(start)
      end.setUTCMonth(end.getUTCMonth() + 3, 0) // day 0 of month+3 = last day of current quarter
      end.setUTCHours(23, 59, 59, 999)
      return end
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

function nextMonday(date: Date): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + 1) // Start searching from day after periodEnd
  while (d.getUTCDay() !== 1) {
    // 1 = Monday
    d.setUTCDate(d.getUTCDate() + 1)
  }
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function firstOfNextMonth(date: Date): Date {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + 1, 1)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function firstOfNextQuarter(date: Date): Date {
  const d = new Date(date)
  const month = d.getUTCMonth()
  const nextQuarterStart = Math.floor(month / 3) * 3 + 3
  if (nextQuarterStart > 11) {
    d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 1)
  } else {
    d.setUTCMonth(nextQuarterStart, 1)
  }
  d.setUTCHours(0, 0, 0, 0)
  return d
}
