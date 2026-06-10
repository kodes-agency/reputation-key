// Notification context — urgent email BullMQ job
// Sends individual urgent notification emails immediately.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { notificationEmailId, notificationId } from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import { emailShell, escapeHtml } from '#/shared/email'

export const URGENT_EMAIL_JOB_NAME = 'urgent-email' as const

export type UrgentEmailJobData = {
  notificationEmailId: string
}

type UrgentEmailDeps = Readonly<{
  emailRepo: NotificationEmailRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  logger: LoggerPort
}>

export const createUrgentEmailJobHandler = (deps: UrgentEmailDeps) => {
  return async (job: Job<UrgentEmailJobData>): Promise<void> => {
    const { logger, emailRepo, notifRepo, userLookup, emailSender } = deps

    const emailId = notificationEmailId(job.data.notificationEmailId)

    // 1. Get the email queue entry by ID
    const entry = await emailRepo.findById(emailId)

    if (!entry || (entry.status !== 'pending' && entry.status !== 'failed')) {
      logger.warn(
        { notificationEmailId: emailId },
        'Urgent email entry not found or not retryable',
      )
      return
    }

    // 2. Get the notification
    const notif = await notifRepo.findById(
      notificationId(entry.notificationId as string),
      entry.organizationId as Parameters<typeof notifRepo.findById>[1],
    )
    if (!notif) {
      logger.warn(
        { notificationId: entry.notificationId },
        'Notification not found for urgent email',
      )
      await emailRepo.markSkipped(emailId)
      // State machine: only 'pending' → 'skipped'. See domain/constructors-transitions.ts markEmailSkipped.
      return
    }

    // 3. Get the user's email address
    const userEmail = await userLookup.getEmail(
      entry.userId as Parameters<typeof userLookup.getEmail>[0],
    )
    if (!userEmail) {
      logger.warn({ userId: entry.userId }, 'User email not found, skipping urgent email')
      await emailRepo.markSkipped(emailId)
      // State machine: only 'pending' → 'skipped'. See domain/constructors-transitions.ts markEmailSkipped.
      return
    }

    // 4. Render single-notification email
    const bodyHtml =
      `<p><strong>${escapeHtml(notif.title)}</strong></p>` +
      (notif.body ? `<p>${escapeHtml(notif.body)}</p>` : '')

    const html = emailShell(bodyHtml)

    // 5. Send & mark sent, or mark failed on error
    try {
      await emailSender.send({
        to: userEmail,
        subject: `${notif.title} — Reputation Key`,
        html,
      })
      await emailRepo.markSent(emailId, new Date())
      // State machine: only 'pending'/'failed' → 'sent'. See domain/constructors-transitions.ts markEmailSent.
      // The repo WHERE clause enforces this at DB level.
    } catch (err) {
      logger.error({ err, notificationEmailId: emailId }, 'Urgent email send failed')
      await emailRepo.markFailed(emailId, new Date())
      // State machine: only 'pending'/'failed' → 'failed'. See domain/constructors-transitions.ts markEmailFailed.
      // The repo WHERE clause enforces this at DB level.
      throw err // re-throw for BullMQ retry
    }
  }
}
