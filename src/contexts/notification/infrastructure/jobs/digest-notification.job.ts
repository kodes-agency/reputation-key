// Notification context — hourly repeatable BullMQ job
// Sends a daily digest email to users whose properties are at ~8am local time.

import type { Job } from 'bullmq'
import { getPool } from '#/shared/db/pool'
import { getLogger } from '#/shared/observability/logger'
import { emailShell, escapeHtml } from '#/shared/email'
import { createNotificationEmailRepository } from '../repositories/notification-email.repository'
import { createNotificationRepository } from '../repositories/notification.repository'
import { createDbUserLookupAdapter } from '../adapters/db-user-lookup.adapter'
import { createResendEmailAdapter } from '../adapters/resend-email.adapter'
import { getDb } from '#/shared/db'

export const DIGEST_JOB_NAME = 'digest-notification' as const

/** Get current hour (0–23) in the given IANA timezone. */
const currentHourInTz = (tz: string): number => {
  const s = new Date().toLocaleString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  })
  return parseInt(s, 10)
}

export const digestNotificationJobHandler = async (_job: Job<void>): Promise<void> => {
  const logger = getLogger()
  const pool = getPool()
  const db = getDb()

  const emailRepo = createNotificationEmailRepository(db)
  const notifRepo = createNotificationRepository(db)
  const userLookup = createDbUserLookupAdapter(db)
  const emailSender = createResendEmailAdapter()

  // 1. Get distinct org + timezone pairs from properties
  const { rows } = await pool.query<{
    organization_id: string
    timezone: string
  }>(
    `SELECT DISTINCT organization_id, COALESCE(timezone, 'UTC') AS timezone FROM properties WHERE deleted_at IS NULL`,
  )

  // 2. Group qualifying orgIds (those at 8am local)
  const qualifyingOrgIds = new Set<string>()
  for (const row of rows) {
    try {
      if (currentHourInTz(row.timezone) === 8) {
        qualifyingOrgIds.add(row.organization_id)
      }
    } catch {
      // invalid timezone — skip
    }
  }

  if (qualifyingOrgIds.size === 0) return

  // 3. For each qualifying org, fetch pending normal-priority emails
  for (const orgId of qualifyingOrgIds) {
    const pending = await emailRepo.findPendingByOrg(orgId, 'normal')
    if (pending.length === 0) continue

    // 4. Group by userId
    const byUser = new Map<string, typeof pending>()
    for (const entry of pending) {
      const uid = entry.userId as string
      if (!byUser.has(uid)) byUser.set(uid, [])
      byUser.get(uid)!.push(entry)
    }

    // 5. For each user: build digest, send, mark sent
    for (const [uid, entries] of byUser) {
      const email = await userLookup.getEmail(
        uid as Parameters<typeof userLookup.getEmail>[0],
      )
      if (!email) continue

      // Collect notification titles/bodies
      const items: string[] = []
      for (const entry of entries) {
        const notif = await notifRepo.findById(entry.notificationId as string, orgId)
        if (notif) {
          items.push(
            `<p><strong>${escapeHtml(notif.title)}</strong>` +
              (notif.body ? `<br/>${escapeHtml(notif.body)}` : '') +
              '</p>',
          )
        }
      }

      if (items.length === 0) continue

      const html = emailShell(items.join('\n'))
      try {
        await emailSender.send({
          to: email,
          subject: 'Your daily digest — Reputation Key',
          html,
        })
        for (const entry of entries) {
          await emailRepo.markSent(entry.id as string, new Date())
        }
      } catch (err) {
        logger.error({ err, uid, orgId }, 'Digest email send failed')
        // Mark each pending email entry as failed so it can be retried
        for (const entry of entries) {
          try {
            await emailRepo.markFailed(entry.id as string, new Date())
          } catch (markErr) {
            logger.error(
              { markErr, notificationEmailId: entry.id as string },
              'Failed to mark digest email as failed',
            )
          }
        }
      }
    }
  }
}
