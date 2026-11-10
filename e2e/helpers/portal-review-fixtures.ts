import type { Page } from '@playwright/test'
import { callServerFnGet } from './fixtures'

/** Hand back the version read by Review & publish, including when a readiness check blocks it. */
export async function reviewedPortalInput(page: Page, portalId: string) {
  const { reviewDigest } = await callServerFnGet<{ reviewDigest: string | null }>(page, {
    file: 'src/contexts/portal/server/portal-review.ts',
    exportName: 'getPortalReview',
    data: { portalId },
  })
  if (reviewDigest === null) throw new Error('The Portal review has no digest')
  return { portalId, reviewedDigest: reviewDigest }
}
