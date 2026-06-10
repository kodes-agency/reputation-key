// Notification context — urgent email BullMQ job
// Sends individual urgent notification emails immediately.

import type { Job } from 'bullmq'
import { getLogger } from '#/shared/observability/logger'
import { emailShell, escapeHtml } from '#/shared/email'
import { createNotificationEmailRepository } from '../repositories/notification-email.repository'
import { createNotificationRepository } from '../repositories/notification.repository'
import { createDbUserLookupAdapter } from '../adapters/db-user-lookup.adapter'
import { createResendEmailAdapter } from '../adapters/resend-email.adapter'
import { getDb } from '#/shared/db'

export const URGENT_EMAIL_JOB_NAME = 'urgent-email' as const

export type UrgentEmailJobData = {
  notificationEmailId: string
}

export const urgentEmailJobHandler = async (
  job: Job<UrgentEmailJobData>,
): Promise<void> => {
  const logger = getLogger()
  const db = getDb()

  const emailRepo = createNotificationEmailRepository(db)
  const notifRepo = createNotificationRepository(db)
  const userLookup = createDbUserLookupAdapter(db)
  const emailSender = createResendEmailAdapter()

  const { notificationEmailId } = job.data

  // 1. Get the email queue entry
  const pending = await emailRepo.findPendingUrgent()
  const entry = pending.find((e) => (e.id as string) === notificationEmailId)

  if (!entry) {
    logger.warn({ notificationEmailId }, 'Urgent email entry not found or not pending')
    return
  }

  // 2. Get the notification
  const notif = await notifRepo.findById(
    entry.notificationId as string,
    entry.organizationId as string,
  )
  if (!notif) {
    logger.warn(
      { notificationId: entry.notificationId as string },
      'Notification not found for urgent email',
    )
    await emailRepo.markSkipped(notificationEmailId)
    return
  }

  // 3. Get the user's email address
  const userEmail = await userLookup.getEmail(
    entry.userId as Parameters<typeof userLookup.getEmail>[0],
  )
  if (!userEmail) {
    logger.warn(
      { userId: entry.userId as string },
      'User email not found, skipping urgent email',
    )
    await emailRepo.markSkipped(notificationEmailId)
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
    await emailRepo.markSent(notificationEmailId, new Date())
  } catch (err) {
    logger.error({ err, notificationEmailId }, 'Urgent email send failed')
    await emailRepo.markFailed(notificationEmailId, new Date())
    throw err // re-throw for BullMQ retry
  }
}
