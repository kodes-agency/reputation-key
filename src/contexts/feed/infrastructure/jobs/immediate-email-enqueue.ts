// How an immediate email becomes a queued job: the job name and capability
// its scope travels under, the execution envelope the delayed gate checks, and
// the family's retry policy. The insert path, the hourly orphan sweep and the
// quiet-hours release all enqueue it this one way.

import type { JobsOptions } from 'bullmq'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { emailCorrelationId } from '../delivery-correlation'
import type { ImmediateEmailEnqueue } from './immediate-orphan-sweep'
import { immediateEmailDispatch, type QuietHoursRelease } from './urgent-email.job'

export type ImmediateEmailJobQueue = Readonly<{
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}>

type ImmediateEmailTarget = Parameters<ImmediateEmailEnqueue>[0]

async function addImmediateEmailJob(
  queue: ImmediateEmailJobQueue,
  target: ImmediateEmailTarget,
  initiatorId: string,
  options: JobsOptions,
): Promise<void> {
  const dispatch = immediateEmailDispatch(target.propertyId)
  await queue.add(
    dispatch.jobName,
    {
      notificationEmailId: target.notificationEmailId,
      ...createJobExecutionEnvelope({
        organizationId: target.organizationId,
        ...(target.propertyId === undefined ? {} : { propertyId: target.propertyId }),
        capability: dispatch.capability,
        initiator: { kind: 'system', id: initiatorId },
        // The delivery logs' identity for the row, so enqueue and send join.
        correlationId: emailCorrelationId(target.notificationEmailId),
      }),
    },
    { ...jobEnqueueOptions(dispatch.jobName), ...options },
  )
}

export const createImmediateEmailEnqueue =
  (queue: ImmediateEmailJobQueue, initiatorId: string): ImmediateEmailEnqueue =>
  (target) =>
    addImmediateEmailJob(queue, target, initiatorId, {})

/**
 * Re-enqueue a quiet-hours hold for the minute the window ends. The job id is
 * the row and its release minute, so a job retried after deferring, or a
 * second deferral to the same end, adds nothing; the handler's sendable-status
 * check makes a run after the hourly sweep already sent it a no-op.
 */
export const createQuietHoursRelease =
  (queue: ImmediateEmailJobQueue, clock: () => Date): QuietHoursRelease =>
  (target, releaseAt) =>
    addImmediateEmailJob(queue, target, 'notification:quiet-hours-release', {
      delay: Math.max(0, releaseAt.getTime() - clock().getTime()),
      jobId: `quiet-release-${target.notificationEmailId}-${releaseAt.getTime()}`,
    })
