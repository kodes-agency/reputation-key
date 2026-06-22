// Notification context — hourly repeatable BullMQ job
// Sends a daily digest email to users whose properties are at ~8am local time.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  notificationEmailId,
  notificationId,
  organizationId as orgId,
} from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { NotificationEmail, Notification } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
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

type OrgTimezoneRow = Readonly<{ organization_id: string; timezone: string }>

/** Distinct org + timezone pairs across all non-deleted properties. */
const fetchOrgTimezones = async (pool: Pool): Promise<OrgTimezoneRow[]> => {
  const { rows } = await pool.query<OrgTimezoneRow>(
    `SELECT DISTINCT organization_id, COALESCE(timezone, 'UTC') AS timezone FROM properties WHERE deleted_at IS NULL`,
  )
  return rows
}

/** Orgs whose local hour is the digest window (8am). */
const selectDigestOrgs = (rows: readonly OrgTimezoneRow[]): Set<string> => {
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
  return qualifyingOrgIds
}

/** Group email-queue entries by their owning user. */
const groupEntriesByUser = (
  entries: readonly NotificationEmail[],
): Map<string, NotificationEmail[]> => {
  const byUser = new Map<string, NotificationEmail[]>()
  for (const entry of entries) {
    const uid = entry.userId as string
    const bucket = byUser.get(uid)
    if (bucket) bucket.push(entry)
    else byUser.set(uid, [entry])
  }
  return byUser
}

/** Render the per-entry notification fragments for one user's digest. */
const buildDigestItems = (
  entries: readonly NotificationEmail[],
  notifMap: ReadonlyMap<string, Notification>,
): string[] => {
  const items: string[] = []
  for (const entry of entries) {
    const notif = notifMap.get(entry.notificationId as string)
    if (!notif) continue
    items.push(
      `<p><strong>${escapeHtml(notif.title)}</strong>` +
        (notif.body ? `<br/>${escapeHtml(notif.body)}` : '') +
        '</p>',
    )
  }
  return items
}

/** Mark every entry in a batch as sent. */
const markEntriesSent = async (
  deps: DigestDeps,
  organizationId: OrganizationId,
  entries: readonly NotificationEmail[],
): Promise<void> => {
  const sentNow = new Date()
  for (const entry of entries) {
    await deps.emailRepo.markSent(
      notificationEmailId(entry.id as string),
      organizationId,
      sentNow,
      sentNow,
    )
    // State machine: only 'pending' → 'sent'. Enforced at DB level by the repo's pending-only WHERE clause.
  }
}

/** Mark every entry in a batch as failed (transient send error). */
const markEntriesFailed = async (
  deps: DigestDeps,
  organizationId: OrganizationId,
  entries: readonly NotificationEmail[],
): Promise<void> => {
  const failNow = new Date()
  for (const entry of entries) {
    try {
      await deps.emailRepo.markFailed(
        notificationEmailId(entry.id as string),
        organizationId,
        failNow,
        failNow,
      )
      // State machine: only 'pending'/'failed' → 'failed'. Enforced at DB level by the repo WHERE clause.
    } catch (markErr) {
      deps.logger.error(
        { markErr, notificationEmailId: entry.id },
        'Failed to mark digest email as failed',
      )
    }
  }
}

/** Build + send one user's digest, then transition the batch's status. */
const sendUserDigest = async (
  deps: DigestDeps,
  organizationId: OrganizationId,
  uid: string,
  entries: readonly NotificationEmail[],
): Promise<void> => {
  const email = await deps.userLookup.getEmail(
    uid as Parameters<typeof deps.userLookup.getEmail>[0],
  )
  if (!email) return

  const notifIds = entries.map((e) => notificationId(e.notificationId as string))
  const notifMap = await deps.notifRepo.findByIds(notifIds, organizationId)
  const items = buildDigestItems(entries, notifMap)
  if (items.length === 0) return

  const html = emailShell(items.join('\n'))
  try {
    await deps.emailSender.send({
      to: email,
      subject: 'Your daily digest — Reputation Key',
      html,
    })
    await markEntriesSent(deps, organizationId, entries)
  } catch (err) {
    deps.logger.error({ err, uid, orgId: organizationId }, 'Digest email send failed')
    await markEntriesFailed(deps, organizationId, entries)
  }
}

/** Send digests for one org: gather pending emails, group by user, send each. */
const sendOrgDigest = async (
  deps: DigestDeps,
  organizationId: OrganizationId,
): Promise<void> => {
  // Pending normal-priority emails plus any orphaned urgent emails
  // (enqueue failed / Redis was down).
  const normal = await deps.emailRepo.findPendingByOrg(organizationId, 'normal')
  const orphanedUrgent = await deps.emailRepo.findPendingByOrg(organizationId, 'urgent')
  const pending = [...normal, ...orphanedUrgent]
  if (pending.length === 0) return

  const byUser = groupEntriesByUser(pending)
  for (const [uid, entries] of byUser) {
    try {
      await sendUserDigest(deps, organizationId, uid, entries)
    } catch (err) {
      deps.logger.error(
        { err, organizationId, userId: uid },
        'digest-notification: sendUserDigest failed — continuing to next user',
      )
    }
  }
}

export const createDigestNotificationJobHandler = (deps: DigestDeps) => {
  return async (_job: Job<void>): Promise<void> => {
    // 1. Distinct org + timezone pairs from properties
    const rows = await fetchOrgTimezones(deps.pool)

    // 2. Orgs currently in their 8am digest window
    const qualifyingOrgIds = selectDigestOrgs(rows)
    if (qualifyingOrgIds.size === 0) return

    // 3. Send each qualifying org's digests.
    // Per-org isolation: one org's failure must not prevent other orgs from
    // receiving their digest, and must not cause retries that re-send to
    // already-succeeded orgs (duplicate emails).
    for (const rawOrgId of qualifyingOrgIds) {
      try {
        await sendOrgDigest(deps, orgId(rawOrgId))
      } catch (err) {
        deps.logger.error(
          { err, organizationId: rawOrgId },
          'digest-notification: org digest failed — continuing to next org',
        )
      }
    }
  }
}
