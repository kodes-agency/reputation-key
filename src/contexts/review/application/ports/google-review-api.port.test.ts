// ARC-03-T9 contract test — Integration/Review seam.
//
// Review owns this contract; Integration implements it. The invariant the seam
// exists to enforce: Review never sees a provider pagination token. It receives
// an OPAQUE cursor reference and hands the same reference back, so a leaked
// Review value can never be replayed against Google.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GoogleReviewPage, GoogleReviewPageRequest } from './google-review-api.port'

const page = (cursorRef: string | null): GoogleReviewPage => ({
  reviews: [],
  totalReviewCount: 0,
  averageRating: null,
  nextCursorRef: cursorRef,
})

describe('GoogleReviewApiPort contract', () => {
  it('exposes an opaque cursor reference, never a provider page token', () => {
    const request: Pick<GoogleReviewPageRequest, 'cursorRef' | 'pageIndex' | 'phase'> = {
      cursorRef: page('ref-2').nextCursorRef,
      pageIndex: 1,
      phase: 'main',
    }

    expect(request.cursorRef).toBe('ref-2')
    const portSource = readFileSync(
      resolve('src/contexts/review/application/ports/google-review-api.port.ts'),
      'utf8',
    )
    expect(portSource).not.toContain('pageToken')
    expect(portSource).not.toContain('nextPageToken')
  })

  it('marks exhaustion with a null cursor rather than an error', () => {
    expect(page(null).nextCursorRef).toBeNull()
  })

  it('keeps a null average rating honest instead of coercing it to zero', () => {
    // Zero is a real rating; "the provider reported none" is not.
    expect(page(null).averageRating).toBeNull()
  })

  it('is consumed through the port, never through a context-private hatch', () => {
    const consumer = readFileSync(resolve('src/contexts/review/build.ts'), 'utf8')

    expect(consumer).not.toContain('.internal.')
    expect(consumer).toContain('GoogleReviewApiPort')
  })

  it('is supplied to Review by name from the composition root', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(composition).toContain(
      'googleReviewApi: integration.reviewSync.googleReviewApi',
    )
  })
})
