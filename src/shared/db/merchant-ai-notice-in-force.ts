import { sql, type SQL } from 'drizzle-orm'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import { MERCHANT_AI_NOTICES_IN_FORCE } from '#/shared/merchant-ai-notice-contract'

/**
 * Whether every capability a grant names is under a notice in force for that
 * capability (ADR 0074); an empty list stands for all of them, as in
 * `isMerchantAiNoticeInForceForCapabilities`. Parameterized so a web/worker
 * rolling deploy always reads its own catalogue.
 */
export function merchantAiNoticeInForceSql(
  version: SQL,
  digest: SQL,
  capabilities: SQL,
): SQL {
  const inForceFor = CURRENT_MERCHANT_AI_CAPABILITIES.map(
    (capability) =>
      sql`(capability = ${capability} AND (${sql.join(
        MERCHANT_AI_NOTICES_IN_FORCE[capability].map(
          (notice) =>
            sql`(${version} = ${notice.noticeVersion} AND ${digest} = ${notice.noticeDigest})`,
        ),
        sql` OR `,
      )}))`,
  )
  const everyCapability = sql`ARRAY[${sql.join(
    CURRENT_MERCHANT_AI_CAPABILITIES.map((capability) => sql`${capability}`),
    sql`, `,
  )}]::text[]`
  return sql`NOT EXISTS (
    SELECT 1
    FROM unnest(CASE WHEN cardinality(${capabilities}) = 0
      THEN ${everyCapability} ELSE ${capabilities} END) AS capability
    WHERE NOT (${sql.join(inForceFor, sql` OR `)})
  )`
}
