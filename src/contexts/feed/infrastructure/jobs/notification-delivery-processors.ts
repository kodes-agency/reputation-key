// The worker's notification delivery processors, assembled from Feed's own
// repositories and resolvers. The worker supplies only what it owns: the
// outbound transport, the signed-link helpers and the scheduled-scope
// authorizers.

import type { Database } from '#/shared/db'
import type { EmailAddressKeys } from '../../domain/notification-email-queue-types'
import type { Job } from 'bullmq'
import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { OneClickUnsubscribeTarget } from '../../application/one-click-unsubscribe-token'
import { createNotificationPropertyScopeResolver } from '../repositories/notification-property-scope.repository'
import { createNotificationOrganizationScopeResolver } from '../repositories/notification-organization-scope.repository'
import { createImmediateEmailEnqueue, createQuietHoursRelease } from './send-emails.job'
import type { NotificationWorkState } from '../../application/ports/notification-work-state.port'
import type { ImmediateEmailJobQueue } from './send-emails.job'
import {
  createSendEmailsHandler,
  type SendEmailsDeps,
  type SendEmailJobData,
} from './send-emails.job'
export { MANDATORY_EMAIL_JOB_NAME, URGENT_EMAIL_JOB_NAME } from './send-emails.job'
import {
  createDigestNotificationJobHandler,
  type DigestDeps,
} from './digest-notification.job'

/** What Feed's build already holds for every processor. */
export type NotificationDeliveryParts = Readonly<{
  db: Database
  emailAddressKeys: EmailAddressKeys
  userLookup: SendEmailsDeps['userLookup']
  recipientStanding: SendEmailsDeps['isRecipientEligible']
  workState: SendEmailsDeps['workState'] & Pick<NotificationWorkState, 'isWaitingMany'>
  clock: () => Date
  logger: LoggerPort
}>

/** What only the worker can supply. */
export type NotificationDeliveryWorkerInput = Readonly<{
  pool: Pool
  jobQueue: ImmediateEmailJobQueue | undefined
  emailSender: SendEmailsDeps['emailSender']
  baseUrl: string
  oneClickUnsubscribeUrl: (
    target: OneClickUnsubscribeTarget,
    keyVersion?: string,
  ) => string
  activeOneClickUnsubscribeKeyVersion: DigestDeps['activeOneClickUnsubscribeKeyVersion']
  authorizeUrgentScope: SendEmailsDeps['authorizeScope']
  authorizeDigestScope: DigestDeps['authorizeScope']
  authorizeMandatoryScope: DigestDeps['authorizeMandatoryScope']
}>

export type NotificationDeliveryProcessors = Readonly<{
  /** One processor serves both the optional and the mandatory name. */
  email: (job: Job) => Promise<void>
  digest: (job: Job) => Promise<void>
}>

export const createNotificationDeliveryProcessors = (
  parts: NotificationDeliveryParts,
  worker: NotificationDeliveryWorkerInput,
): NotificationDeliveryProcessors => {
  const resolvePropertyScope = createNotificationPropertyScopeResolver(worker.pool)
  // ADR 0046 r.3: the organization fallback timezone plus property display
  // names for digest grouping.
  const resolveOrganizationScope = createNotificationOrganizationScopeResolver(
    worker.pool,
  )
  const urgentEmailHandler = createSendEmailsHandler({
    db: parts.db,
    emailAddressKeys: parts.emailAddressKeys,
    userLookup: parts.userLookup,
    emailSender: worker.emailSender,
    logger: parts.logger,
    clock: parts.clock,
    resolvePropertyScope,
    resolveOrganizationScope,
    authorizeScope: worker.authorizeUrgentScope,
    isRecipientEligible: parts.recipientStanding,
    workState: parts.workState,
    baseUrl: worker.baseUrl,
    oneClickUnsubscribeUrl: worker.oneClickUnsubscribeUrl,
    // Quiet hours end on the minute; the hourly sweep is only the fallback.
    scheduleRelease: worker.jobQueue
      ? createQuietHoursRelease(worker.jobQueue, parts.clock)
      : undefined,
  })

  const digestHandler = createDigestNotificationJobHandler({
    pool: worker.pool,
    db: parts.db,
    emailAddressKeys: parts.emailAddressKeys,
    userLookup: parts.userLookup,
    emailSender: worker.emailSender,
    logger: parts.logger,
    clock: parts.clock,
    batchIdGen: () => crypto.randomUUID(),
    resolveOrganizationScope,
    resolvePropertyScope,
    authorizeScope: worker.authorizeDigestScope,
    authorizeMandatoryScope: worker.authorizeMandatoryScope,
    isRecipientEligible: parts.recipientStanding,
    workState: parts.workState,
    baseUrl: worker.baseUrl,
    activeOneClickUnsubscribeKeyVersion: worker.activeOneClickUnsubscribeKeyVersion,
    oneClickUnsubscribeUrl: worker.oneClickUnsubscribeUrl,
    enqueueImmediate: worker.jobQueue
      ? createImmediateEmailEnqueue(worker.jobQueue, 'notification:delivery-sweep')
      : async () => {},
  })

  return Object.freeze({
    email: async (job: Job) => {
      await urgentEmailHandler(job as Job<SendEmailJobData>)
    },
    digest: async (job: Job) => {
      await digestHandler(job as Job<void>)
    },
  })
}
