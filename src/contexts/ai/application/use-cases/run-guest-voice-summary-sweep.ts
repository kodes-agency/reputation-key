// The hourly sweep behind the Monday email (decision 11 of the v3 contract). It lists the
// Properties whose Monday morning it is, decides each under current platform policy, asks
// the plan whether a summary goes out and, if so, records it as one fact. Feed finds the
// managers who asked for it and mails it.
//
// It is tenant-cross and only enumerates: the schedule's firing was admitted without
// asking about any tenant, so every Property is decided here, for its own Organization,
// before anything of it is read. One Property failing never stops the others, and a sweep
// that had a failure says so at the end so the queue retries it; a Property already done
// this Monday is recorded once however often it is asked.
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { AiGuestVoiceSummarySchedulePort } from '../ports/ai-guest-voice-summary-schedule.port'
import type {
  GuestVoiceSummaryPlan,
  PlanGuestVoiceSummaryInput,
} from './plan-guest-voice-summary'

/** Properties one sweep looks at. A Property not reached stays due for the next hour. */
export const GUEST_VOICE_SUMMARY_SWEEP_LIMIT = 500

export type AuthorizeGuestVoiceSummaryScope = (
  organizationId: OrganizationId,
  propertyId: PropertyId,
) => Promise<boolean>

export type GuestVoiceSummarySweepStats = Readonly<{
  inspected: number
  /** Facts this sweep recorded. */
  sent: number
  /** Properties whose Monday summary was already recorded by an earlier sweep. */
  alreadySent: number
  quiet: number
  skipped: number
  denied: number
  failed: number
}>

export class GuestVoiceSummarySweepError extends Error {
  readonly stats: GuestVoiceSummarySweepStats
  constructor(stats: GuestVoiceSummarySweepStats) {
    super(`Guest voice summary sweep: ${stats.failed} Properties failed`)
    this.name = 'GuestVoiceSummarySweepError'
    this.stats = stats
  }
}

export type RunGuestVoiceSummarySweepDependencies = Readonly<{
  schedule: AiGuestVoiceSummarySchedulePort
  plan: (input: PlanGuestVoiceSummaryInput) => Promise<GuestVoiceSummaryPlan>
  nowEpochMillis: () => number
  logger: Pick<LoggerPort, 'warn'>
}>

type Tally = { -readonly [Key in keyof GuestVoiceSummarySweepStats]: number }

export function createRunGuestVoiceSummarySweep(
  dependencies: RunGuestVoiceSummarySweepDependencies,
): (
  input: Readonly<{ authorizeScope: AuthorizeGuestVoiceSummaryScope }>,
) => Promise<GuestVoiceSummarySweepStats> {
  return async ({ authorizeScope }) => {
    const now = dependencies.nowEpochMillis()
    const due = await dependencies.schedule.listDue({
      nowEpochMillis: now,
      limit: GUEST_VOICE_SUMMARY_SWEEP_LIMIT,
    })
    const tally: Tally = {
      inspected: due.length,
      sent: 0,
      alreadySent: 0,
      quiet: 0,
      skipped: 0,
      denied: 0,
      failed: 0,
    }
    for (const property of due) {
      try {
        if (!(await authorizeScope(property.organizationId, property.propertyId))) {
          tally.denied += 1
          continue
        }
        const plan = await dependencies.plan(property)
        if (plan.status === 'quiet') tally.quiet += 1
        else if (plan.status === 'skipped') tally.skipped += 1
        else {
          const recorded = await dependencies.schedule.publish({
            ...property,
            plan,
            occurredAt: new Date(now),
          })
          if (recorded) tally.sent += 1
          else tally.alreadySent += 1
        }
      } catch (error) {
        // Never a tenant identifier in a log field (BQC-7.3); the count says enough.
        tally.failed += 1
        dependencies.logger.warn(
          { err: error },
          'Guest voice summary: a Property could not be decided',
        )
      }
    }
    if (tally.failed > 0) throw new GuestVoiceSummarySweepError(tally)
    return tally
  }
}
