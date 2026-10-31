import { sql, type SQL } from 'drizzle-orm'
import { MERCHANT_AI_NOTICES_IN_FORCE } from '#/shared/merchant-ai-notice-contract'

/** Parameterized so a web/worker rolling deploy always reads its own catalogue. */
export function merchantAiNoticeInForceSql(version: SQL, digest: SQL): SQL {
  return sql`(${sql.join(
    MERCHANT_AI_NOTICES_IN_FORCE.map(
      (notice) =>
        sql`(${version} = ${notice.noticeVersion} AND ${digest} = ${notice.noticeDigest})`,
    ),
    sql` OR `,
  )})`
}
