/**
 * An operator's acknowledgement that a family's failed on-demand work is
 * answered, for the case no redrive can answer.
 *
 * A family latches `repair_required` when its latest on-demand failure is
 * newer than its `lastRepairAt`, and the worker writes `lastRepairAt` only when
 * a job carrying quarantine redrive metadata succeeds. A dead letter that is a
 * continuation of an already-failed run fails again when redriven, so nothing
 * ever sets it: the family stays unready, and its alert keeps firing, long
 * after every later run completed. Discarding the dead letter, or its expiry,
 * does not clear the latch either (runbooks §17).
 *
 * `acknowledge` sets `lastRepairAt` once the cause is fixed, and only then:
 *
 *  - It refuses while the family still has a dead letter or a retained failed
 *    job newer than its latest success, so it cannot hide a failure someone
 *    can still see. The operator discards or redrives those first.
 *  - It refuses while the failure it would answer is newer than the family's
 *    latest success, though BullMQ's bounded failed set no longer shows it:
 *    nothing shows the cause fixed. This also keeps the stamp at or before the
 *    latest success, so it can never answer a stall recorded after it.
 *  - It writes the time of the newest on-demand failure it saw, not the clock's now, and
 *    no other field. A failure that lands after the read is later than that
 *    time and latches again; an operator's clock cannot put the head in the
 *    future, which the report reads as an invalid observation.
 *  - It answers the on-demand latch only. A failed firing is answered by a
 *    later success, so it is left alone.
 *
 * The read side joins the head to the live queues exactly as the job-runtime
 * report does (`observeFamily`), so the verdict is about the row the alert
 * reads.
 */

import {
  assessJobRuntime,
  heldRepairLatches,
  type JobOperationalContract,
  type JobRuntimeObservation,
  type JobRuntimePosture,
  type JobRuntimeReadiness,
  type JobRuntimeReadinessReason,
} from './runtime-authority'
import {
  deadLettersByJob,
  observeFamily,
  readQueueEvidence,
  type JobRuntimeObservationStore,
  type JobRuntimeQueuePort,
} from './runtime-observations'

/** The family as the job-runtime report row reads it, plus its repair time. */
export type JobRepairFamily = Readonly<{
  jobName: string
  posture: JobRuntimePosture
  schedule: string
  ready: boolean
  reasons: readonly JobRuntimeReadinessReason[]
  lastSucceededAt: string | null
  lastOnDemandFailureAt: string | null
  lastScheduleFailureAt: string | null
  lastRepairAt: string | null
}>

/** What stands between the operator and an acknowledgement. */
export type JobRepairBlockers = Readonly<{
  /** The family's quarantine entries: discard or redrive each first. */
  deadLetterIds: readonly string[]
  /** Retained failed jobs of the family newer than its latest success. */
  unrecoveredFailures: number
  /** The on-demand failure it would answer is newer than the latest success. */
  failureNewerThanLatestSuccess: boolean
}>

export type JobRepairAssessment =
  | Readonly<{ outcome: 'unknown_job'; knownJobs: readonly string[] }>
  | Readonly<{ outcome: 'no_runtime_head' }>
  /** The on-demand latch is not what holds the family, so there is nothing to write. */
  | Readonly<{ outcome: 'nothing_to_acknowledge'; family: JobRepairFamily }>
  | Readonly<{
      outcome: 'blocked'
      family: JobRepairFamily
      blockers: JobRepairBlockers
    }>
  | Readonly<{
      outcome: 'acknowledgeable'
      family: JobRepairFamily
      /** The newest failure's time, which `lastRepairAt` would be set to (ISO). */
      setsLastRepairAt: string
    }>

export type JobRepairAcknowledgement =
  | Readonly<{ written: false; assessment: JobRepairAssessment }>
  | Readonly<{ written: true; before: JobRepairFamily; after: JobRepairAssessment }>

export type JobRepairAcknowledger = Readonly<{
  /** Read-only: what an acknowledgement would do, or why it would not. */
  assess(jobName: string): Promise<JobRepairAssessment>
  /** Assess, and write `lastRepairAt` only when the verdict is `acknowledgeable`. */
  acknowledge(jobName: string): Promise<JobRepairAcknowledgement>
}>

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function isLater(left: Date, right: Date | null): boolean {
  return right === null || left.getTime() > right.getTime()
}

function describeFamily(
  contract: JobOperationalContract,
  observation: JobRuntimeObservation,
  readiness: JobRuntimeReadiness,
): JobRepairFamily {
  return {
    jobName: contract.jobName,
    posture: contract.posture,
    schedule: contract.schedule,
    ready: readiness.ready,
    reasons: readiness.reasons,
    lastSucceededAt: isoOrNull(observation.lastSucceededAt),
    lastOnDemandFailureAt: isoOrNull(observation.lastOnDemandFailureAt),
    lastScheduleFailureAt: isoOrNull(observation.lastScheduleFailureAt),
    lastRepairAt: isoOrNull(observation.lastRepairAt),
  }
}

/**
 * Retained failed jobs of the family that no later success followed. A job
 * BullMQ recorded no finish time for cannot be shown to be older, so it counts.
 */
function unrecoveredFailureCount(
  failures: readonly (Date | null)[],
  lastSucceededAt: Date | null,
): number {
  return failures.filter(
    (finishedAt) => finishedAt === null || isLater(finishedAt, lastSucceededAt),
  ).length
}

export function createJobRepairAcknowledger(
  input: Readonly<{
    contracts: readonly JobOperationalContract[]
    store: JobRuntimeObservationStore
    /**
     * Every queue and the quarantine are required: one that is missing would
     * read as a family with no failures and no dead letters.
     */
    queues: Readonly<{ default: JobRuntimeQueuePort; background: JobRuntimeQueuePort }>
    quarantine: JobRuntimeQueuePort
    clock: () => Date
  }>,
): JobRepairAcknowledger {
  const assess = async (jobName: string): Promise<JobRepairAssessment> => {
    const contract = input.contracts.find((candidate) => candidate.jobName === jobName)
    if (!contract) {
      return {
        outcome: 'unknown_job',
        knownJobs: input.contracts.map(({ jobName: name }) => name).sort(),
      }
    }

    const collectedFrom = input.clock()
    const [record, evidence, deadLetters] = await Promise.all([
      input.store.read(jobName),
      readQueueEvidence([input.queues.default, input.queues.background], collectedFrom),
      deadLettersByJob(input.quarantine),
    ])
    if (!record) return { outcome: 'no_runtime_head' }

    const deadLetterIds = deadLetters.get(jobName) ?? []
    const observation = observeFamily(contract, record, evidence, deadLetterIds.length)
    const readiness = assessJobRuntime({
      contract,
      observation,
      runtimeStartedAt: record.runtimeStartedAt,
      // After the scans, like the report: work finishing mid-read is not from the future.
      now: input.clock(),
    })
    const family = describeFamily(contract, observation, readiness)

    // A dark or invalid row never reads the latch, so `repair_required` is the
    // test, with the latch saying which kind of failure holds it.
    const failure = observation.lastOnDemandFailureAt
    if (
      failure === null ||
      !readiness.reasons.includes('repair_required') ||
      !heldRepairLatches(contract, observation).onDemand
    ) {
      return { outcome: 'nothing_to_acknowledge', family }
    }

    const unrecoveredFailures = unrecoveredFailureCount(
      evidence.failures.get(jobName) ?? [],
      observation.lastSucceededAt,
    )
    const failureNewerThanLatestSuccess = isLater(failure, observation.lastSucceededAt)
    if (
      deadLetterIds.length > 0 ||
      unrecoveredFailures > 0 ||
      failureNewerThanLatestSuccess
    ) {
      return {
        outcome: 'blocked',
        family,
        blockers: { deadLetterIds, unrecoveredFailures, failureNewerThanLatestSuccess },
      }
    }
    return { outcome: 'acknowledgeable', family, setsLastRepairAt: failure.toISOString() }
  }

  return {
    assess,

    async acknowledge(jobName) {
      const assessment = await assess(jobName)
      if (assessment.outcome !== 'acknowledgeable') return { written: false, assessment }
      await input.store.recordRepairAcknowledged({
        jobName,
        at: new Date(assessment.setsLastRepairAt),
      })
      return { written: true, before: assessment.family, after: await assess(jobName) }
    },
  }
}
