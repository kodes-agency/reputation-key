import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { MERCHANT_AI_NOTICE_CHANGES } from '#/shared/merchant-ai-notice-contract'
import { materiallyChangedMerchantAiCapabilities } from '#/shared/merchant-ai-notice-change'

const current = MERCHANT_AI_NOTICE_CHANGES[0]!
const previous = current.replaces!
const older = MERCHANT_AI_NOTICE_CHANGES[1]!.replaces!

describe('Merchant AI notice material-change SQL catalogue parity', () => {
  it.each([
    [previous, current],
    [older, current],
    [older, previous],
    [current, current],
    [{ ...previous, noticeDigest: 'f'.repeat(64) }, current],
    [previous, { ...current, noticeVersion: 'unknown' }],
  ])('matches the TypeScript path from %j to %j', async (before, after) => {
    const result = await getDb().execute<{ changes: string[] }>(
      sql`SELECT merchant_ai_notice_material_changes_v1(${before.noticeVersion}, ${before.noticeDigest}, ${after.noticeVersion}, ${after.noticeDigest}) AS changes`,
    )
    expect(result.rows[0]?.changes).toEqual(
      materiallyChangedMerchantAiCapabilities(before, after),
    )
  })

  it('has only the live 27-argument transition after forward migration', async () => {
    const result = await getDb().execute<{ arguments: number }>(
      sql`SELECT pronargs AS arguments FROM pg_proc WHERE proname = 'apply_merchant_ai_transition_v1' AND pronamespace = 'public'::regnamespace`,
    )
    expect(result.rows).toEqual([{ arguments: 27 }])
  })
})
