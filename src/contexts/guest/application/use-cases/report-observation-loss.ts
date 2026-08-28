import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  GuestObservationLossKind,
  GuestObservationLossMonitor,
  GuestObservationLossReportOutcome,
} from '../ports/guest-observation-loss-monitor.port'

export type ReportGuestObservationLossDeps = Readonly<{
  monitor: Pick<GuestObservationLossMonitor, 'record'>
  clock: () => Date
  logger: LoggerPort
}>

/** The monitor is evidence, never part of the public journey's latency budget. */
export const GUEST_OBSERVATION_LOSS_REPORT_BUDGET_MS = 250

async function recordWithinBudget(
  write: Promise<void>,
): Promise<'recorded' | 'monitor_unavailable'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      write.then(
        () => 'recorded' as const,
        () => 'monitor_unavailable' as const,
      ),
      new Promise<'monitor_unavailable'>((resolve) => {
        timer = setTimeout(
          () => resolve('monitor_unavailable'),
          GUEST_OBSERVATION_LOSS_REPORT_BUDGET_MS,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Record a suppressed Guest analytics loss without ever widening the public
 * failure. The log surface is a closed pair of enums: no error object,
 * tenant scope, session, Portal, destination, or payload can enter it.
 */
export const reportGuestObservationLoss =
  (deps: ReportGuestObservationLossDeps) =>
  async (kind: GuestObservationLossKind): Promise<GuestObservationLossReportOutcome> => {
    let outcome: GuestObservationLossReportOutcome
    try {
      outcome = await recordWithinBudget(
        deps.monitor.record({ kind, occurredAt: deps.clock() }),
      )
    } catch {
      outcome = 'monitor_unavailable'
    }
    try {
      deps.logger.warn(
        {
          observationKind: kind,
          observationLossMonitor: outcome === 'recorded' ? 'recorded' : 'unavailable',
        },
        'Guest analytics observation was lost',
      )
    } catch {
      // Logging is the last-resort signal, never public-journey authority.
    }
    return outcome
  }
