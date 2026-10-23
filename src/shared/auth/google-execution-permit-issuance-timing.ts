/**
 * Where a permit issuance's time went (#946, Sentry REPKEY-18): twice an
 * import's token refresh lost ~12 s between its permit being issued and the
 * egress gateway admitting it, and `authorization_execution_permits.admitted_at`
 * is read at the START of the issuer's transaction, so nothing said whether the
 * time went into issuance itself. The timer splits one issuance into the
 * stages that can wait: a pool connection plus BEGIN, the control read, the
 * authorization check, the permit insert and COMMIT.
 *
 * Normal issuance is fast (admitted to started: p50 19 ms, p99 98 ms), so only
 * a slow one is logged. The record carries the closed code sets `capability`
 * and `routeKey` and durations, and nothing that names a tenant: no
 * organization, property, connection, user or permit id, no operation key and
 * no hash.
 */

/** Total issuance time from which one warning is logged. */
const SLOW_PERMIT_ISSUANCE_THRESHOLD_MS = 1000

const SLOW_PERMIT_ISSUANCE_MESSAGE = 'Google execution permit issuance was slow'

export type PermitIssuanceLogger = Readonly<{
  warn(fields: Readonly<Record<string, unknown>>, message: string): void
}>

/** The stages timed around a store or authorization call. */
export type PermitIssuanceStage = 'loadControlMs' | 'authorizeMs' | 'insertPermitMs'

type PermitIssuanceStages = Readonly<
  Partial<Record<PermitIssuanceStage | 'beginMs' | 'commitMs' | 'totalMs', number>>
>

export type PermitIssuanceTimer = Readonly<{
  /** The transaction callback started: pool wait and BEGIN are over. */
  begun(): void
  /** Times `run`, also when it throws. */
  stage<T>(stage: PermitIssuanceStage, run: () => Promise<T>): Promise<T>
  /** The transaction callback returned: COMMIT is next. */
  callbackReturned(): void
  /** The issuance ended with `outcome`; logs once if it was slow. */
  finish(outcome: string): void
}>

export type PermitIssuanceTimerOptions = Readonly<{
  nowMs?: () => number
  logger?: PermitIssuanceLogger
  capability: string
  routeKey: string
}>

const NO_TIMING: PermitIssuanceTimer = Object.freeze({
  begun: () => undefined,
  stage: (_stage, run) => run(),
  callbackReturned: () => undefined,
  finish: () => undefined,
})

export function createPermitIssuanceTimer(
  options: PermitIssuanceTimerOptions,
): PermitIssuanceTimer {
  const { nowMs, logger } = options
  // Timing needs a clock and somewhere to report; with either missing the
  // issuance runs exactly as it did before there was a timer.
  if (!nowMs || !logger) return NO_TIMING
  const startedAt = nowMs()
  let stages: PermitIssuanceStages = {}
  let callbackReturnedAt: number | undefined
  const record = (
    key: keyof PermitIssuanceStages,
    since: number,
    until: number,
  ): void => {
    stages = { ...stages, [key]: Math.round(until - since) }
  }
  return Object.freeze({
    begun: () => record('beginMs', startedAt, nowMs()),
    stage: async (stage, run) => {
      const stageStartedAt = nowMs()
      try {
        return await run()
      } finally {
        record(stage, stageStartedAt, nowMs())
      }
    },
    callbackReturned: () => {
      callbackReturnedAt = nowMs()
    },
    finish: (outcome) => {
      const endedAt = nowMs()
      if (callbackReturnedAt !== undefined)
        record('commitMs', callbackReturnedAt, endedAt)
      record('totalMs', startedAt, endedAt)
      if ((stages.totalMs ?? 0) < SLOW_PERMIT_ISSUANCE_THRESHOLD_MS) return
      warnSlowIssuance(logger, options, outcome, stages)
    },
  })
}

function warnSlowIssuance(
  logger: PermitIssuanceLogger,
  options: PermitIssuanceTimerOptions,
  outcome: string,
  stages: PermitIssuanceStages,
): void {
  try {
    logger.warn(
      {
        surface: 'google-execution-permit-issuer',
        stage: 'issuance',
        capability: options.capability,
        routeKey: options.routeKey,
        outcome,
        ...stages,
      },
      SLOW_PERMIT_ISSUANCE_MESSAGE,
    )
  } catch {
    // A diagnostic must not change what issuance returns or mask the error it
    // is reporting on.
  }
}
