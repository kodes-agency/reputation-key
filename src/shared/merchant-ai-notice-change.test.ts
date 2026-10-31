import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CURRENT_MERCHANT_AI_NOTICE,
  MERCHANT_AI_NOTICE_CHANGES,
} from './merchant-ai-notice-contract'

describe('Merchant AI notice change catalogue', () => {
  it('keeps the served notice first, including its material changes', () => {
    expect(MERCHANT_AI_NOTICE_CHANGES[0]).toMatchObject({
      noticeVersion: CURRENT_MERCHANT_AI_NOTICE.version,
      noticeDigest: CURRENT_MERCHANT_AI_NOTICE.digest,
      materiallyChanges: CURRENT_MERCHANT_AI_NOTICE.materiallyChanges,
    })
  })

  it.each(['../../drizzle/0088_reply_drafting_v2_release.sql', './db/db-constructs.sql'])(
    'lists the same changes in the same order in TypeScript and %s',
    (path) => {
      const sql = readFileSync(new URL(path, import.meta.url), 'utf8')
      const values = /FROM \(VALUES([\s\S]*?)\) AS notices/u.exec(sql)?.[1] ?? ''
      const rows = [
        ...values.matchAll(
          /\('([^']+)', '([^']+)',\s*'([^']+)', '([^']+)',\s*ARRAY\[([^\]]*)\]::text\[\]\)/gu,
        ),
      ].map(
        ([, noticeVersion, noticeDigest, previousVersion, previousDigest, changed]) => ({
          noticeVersion,
          noticeDigest,
          replaces: { noticeVersion: previousVersion, noticeDigest: previousDigest },
          materiallyChanges: [...(changed ?? '').matchAll(/'([^']+)'/gu)].map(
            ([, capability]) => capability,
          ),
        }),
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(rows).toEqual(MERCHANT_AI_NOTICE_CHANGES)
    },
  )
})
