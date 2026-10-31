import { describe, expect, it } from 'vitest'
import {
  MERCHANT_AI_NOTICE_CHANGES,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  type MerchantAiNoticeReference,
} from '#/shared/merchant-ai-notice-contract'
import { analysisNoticeStillCovers } from './ai-analysis-notice-coverage'

const served = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}
const changeFor = (notice: MerchantAiNoticeReference) =>
  MERCHANT_AI_NOTICE_CHANGES.find(
    (change) =>
      change.noticeVersion === notice.noticeVersion &&
      change.noticeDigest === notice.noticeDigest,
  )
const storedUnder = (
  notice: Readonly<{ noticeVersion: string | null; noticeDigest: string | null }>,
) => ({
  operationNoticeVersion: notice.noticeVersion,
  operationNoticeDigest: notice.noticeDigest,
})

describe('analysisNoticeStillCovers', () => {
  it('covers an analysis stored under the grant notice', () => {
    expect(analysisNoticeStillCovers(storedUnder(served), served)).toBe(true)
  })

  it('covers an analysis stored under a notice the grant notice changed only for drafting', () => {
    const servedChange = changeFor(served)
    expect(servedChange?.materiallyChanges).not.toContain('review_analysis')

    expect(analysisNoticeStillCovers(storedUnder(servedChange!.replaces!), served)).toBe(
      true,
    )
  })

  it('withholds an analysis stored before a notice that changed analysis', () => {
    const previous = changeFor(served)!.replaces!
    const previousChange = changeFor(previous)
    expect(previousChange?.materiallyChanges).toContain('review_analysis')

    expect(
      analysisNoticeStillCovers(storedUnder(previousChange!.replaces!), served),
    ).toBe(false)
  })

  it('withholds an analysis stored without a notice or under an unknown digest', () => {
    expect(
      analysisNoticeStillCovers(
        storedUnder({ noticeVersion: null, noticeDigest: null }),
        served,
      ),
    ).toBe(false)
    expect(
      analysisNoticeStillCovers(
        storedUnder({ ...served, noticeDigest: '0'.repeat(64) }),
        served,
      ),
    ).toBe(false)
  })
})
