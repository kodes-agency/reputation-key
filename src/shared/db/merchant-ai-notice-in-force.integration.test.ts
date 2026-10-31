import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import {
  MERCHANT_AI_NOTICE_CHANGES,
  isMerchantAiNoticeInForceForCapabilities,
} from '#/shared/merchant-ai-notice-contract'
import { merchantAiNoticeInForceSql } from './merchant-ai-notice-in-force'

const served = MERCHANT_AI_NOTICE_CHANGES[0]!
const notices = [
  served,
  served.replaces!,
  MERCHANT_AI_NOTICE_CHANGES[1]!.replaces!,
  { ...served, noticeDigest: 'f'.repeat(64) },
]
const capabilitySets: ReadonlyArray<ReadonlyArray<MerchantAiCapability>> = [
  [],
  ['review_analysis'],
  ['reply_drafting'],
  ['property_trends'],
  ['review_analysis', 'property_trends'],
  ['review_analysis', 'reply_drafting', 'property_trends'],
]
/** One text[] parameter; the sql tag would spread a JS array into a list. */
const textArray = (values: ReadonlyArray<string>) => `{${values.join(',')}}`
const cases = notices.flatMap((notice) =>
  capabilitySets.map((capabilities) => [notice, capabilities] as const),
)

describe('Merchant AI notice-in-force SQL parity', () => {
  it.each(cases)(
    'agrees with the TypeScript check for %j with %j',
    async (notice, capabilities) => {
      const result = await getDb().execute<{ in_force: boolean }>(
        sql`SELECT ${merchantAiNoticeInForceSql(
          sql`${notice.noticeVersion}::varchar`,
          sql`${notice.noticeDigest}::varchar`,
          sql`${textArray(capabilities)}::text[]`,
        )} AS in_force`,
      )
      expect(result.rows[0]?.in_force).toBe(
        isMerchantAiNoticeInForceForCapabilities({ ...notice, capabilities }),
      )
    },
  )

  it('keeps analysis and trends under the notice the served one replaced, not drafting', async () => {
    const replaced = served.replaces!
    const read = async (capabilities: ReadonlyArray<MerchantAiCapability>) =>
      (
        await getDb().execute<{ in_force: boolean }>(
          sql`SELECT ${merchantAiNoticeInForceSql(
            sql`${replaced.noticeVersion}::varchar`,
            sql`${replaced.noticeDigest}::varchar`,
            sql`${textArray(capabilities)}::text[]`,
          )} AS in_force`,
        )
      ).rows[0]?.in_force
    expect(await read(['review_analysis', 'property_trends'])).toBe(true)
    expect(await read(['review_analysis', 'reply_drafting', 'property_trends'])).toBe(
      false,
    )
  })
})
