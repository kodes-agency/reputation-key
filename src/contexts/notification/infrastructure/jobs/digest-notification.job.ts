// Notification context — hourly repeatable BullMQ job
// Sends a daily digest email to users whose properties are at ~8am local time.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  notificationId,
  notificationEmailId,
  organizationId as orgId,
} from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { Pool } from 'pg'
import { emailShell, escapeHtml } from '#/shared/email'

export const DIGEST_JOB_NAME = 'digest-notification' as const

type DigestDeps = Readonly<{
  pool: Pool
  emailRepo: NotificationEmailRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  logger: LoggerPort
}>

/** Get current hour (0–23) in the given IANA timezone. */
const currentHourInTz = (tz: string): number => {
  const s = new Date().toLocaleString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  })
  return parseInt(s, 10)
}

export const createDigestNotificationJobHandler = (deps: DigestDeps) => {
  return async (_job: Job<void>): Promise<void> => {
    const { pool, emailRepo, notifRepo, userLookup, emailSender, logger } = deps

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
    for (const rawOrgId of qualifyingOrgIds) {
      const pending = await emailRepo.findPendingByOrg(orgId(rawOrgId), 'normal')
      if (pending.length === 0) continue

      // 4. Group by userId
      const byUser = new Map<string, (typeof pending)[number][]>()
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
          const notif = await notifRepo.findById(
            notificationId(entry.notificationId as string),
            orgId(rawOrgId),
          )
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
          const sentNow = new Date()
          for (const entry of entries) {
            await emailRepo.markSent(
              notificationEmailId(entry.id as string),
              orgId(rawOrgId),
              sentNow,
              sentNow,
            )
            // State machine: only 'pending' → 'sent'. See domain/constructors-transitions.ts markEmailSent.
            // The repo WHERE clause (pending-only in findPendingByOrg) enforces this at DB level.
          }
        } catch (err) {
          logger.error({ err, uid, orgId: rawOrgId }, 'Digest email send failed')
          const failNow = new Date()
          for (const entry of entries) {
            try {
              await emailRepo.markFailed(
                notificationEmailId(entry.id as string),
                orgId(rawOrgId),
                failNow,
                failNow,
              )
              // State machine: only 'pending'/'failed' → 'failed'. See domain/constructors-transitions.ts markEmailFailed.
              // The repo WHERE clause enforces this at DB level.
            } catch (markErr) {
              logger.error(
                { markErr, notificationEmailId: entry.id },
                'Failed to mark digest email as failed',
              )
            }
          }
        }
      }
    }
  }
}
