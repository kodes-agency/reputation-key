import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { MERCHANT_AI_NOTICE_ANNOUNCEMENTS } from '#/shared/merchant-ai-notice-announcements'
import type { MerchantAiNoticeUpdateStore } from '../../application/use-cases/merchant-ai-notice-updates'

type UpdateRow = { notice_version: string; notice_digest: string; renewed_at: Date }

/** Scope predicates remain on evidence and receipts, including the anti-join. */
export function createMerchantAiNoticeUpdateStore(
  db: Database,
): MerchantAiNoticeUpdateStore {
  return {
    async latest(input) {
      const result = await db.execute<UpdateRow>(sql`
        SELECT e.notice_version, e.notice_digest, max(e.occurred_at) AS renewed_at
        FROM merchant_ai_consent_evidence e
        WHERE e.organization_id = ${input.organizationId} AND e.reason_code = 'standing_renewal'
          AND (${!input.unseenOnly} OR NOT EXISTS (
            SELECT 1 FROM merchant_ai_notice_update_receipts r
            WHERE r.organization_id = e.organization_id AND r.user_id = ${input.actorUserId}
              AND (r.notice_version > e.notice_version OR (r.notice_version = e.notice_version AND r.notice_digest = e.notice_digest))
          ))
        GROUP BY e.notice_version, e.notice_digest
        ORDER BY e.notice_version DESC, max(e.occurred_at) DESC LIMIT 1
      `)
      const row = result.rows[0]
      const announcement = row && MERCHANT_AI_NOTICE_ANNOUNCEMENTS[row.notice_version]
      // An older web deployment may not yet know what the newer worker applied.
      return row && announcement
        ? {
            ...announcement,
            noticeVersion: row.notice_version,
            noticeDigest: row.notice_digest,
            renewedAt: new Date(row.renewed_at).toISOString(),
          }
        : null
    },
    async markSeen(input) {
      // Notice ids carry their ISO release date. Only an actually applied target
      // may cover itself and older releases; a made-up/future id writes nothing.
      await db.execute(sql`
        INSERT INTO merchant_ai_notice_update_receipts (user_id, organization_id, notice_version, notice_digest)
        SELECT DISTINCT ${input.actorUserId}, e.organization_id, e.notice_version, e.notice_digest
        FROM merchant_ai_consent_evidence e
        WHERE e.organization_id = ${input.organizationId} AND e.reason_code = 'standing_renewal'
          AND e.notice_version <= ${input.noticeVersion}
          AND EXISTS (SELECT 1 FROM merchant_ai_consent_evidence target
            WHERE target.organization_id = ${input.organizationId} AND target.reason_code = 'standing_renewal'
              AND target.notice_version = ${input.noticeVersion} AND target.notice_digest = ${input.noticeDigest})
        ON CONFLICT DO NOTHING
      `)
    },
  }
}
