// Contract test — Integration/Review seam.
//
// Review owns this contract; Integration implements it. The invariant the seam
// exists to enforce: Review never sees a provider pagination token. It receives
// an OPAQUE cursor reference and hands the same reference back, so a leaked
// Review value can never be replayed against Google.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('GoogleReviewApiPort contract', () => {
  it('exposes an opaque cursor reference, never a provider page token', () => {
    const portSource = readFileSync(
      resolve('src/contexts/review/application/ports/google-review-api.port.ts'),
      'utf8',
    )
    expect(portSource).not.toContain('pageToken')
    expect(portSource).not.toContain('nextPageToken')
  })

  it('is consumed through the port, never through a context-private hatch', () => {
    const consumer = readFileSync(resolve('src/contexts/review/build.ts'), 'utf8')

    expect(consumer).not.toContain('.internal.')
    expect(consumer).toContain('GoogleReviewApiPort')
  })

  it('is supplied to Review by name from the composition root', () => {
    const composition = readFileSync(resolve('src/composition/review-wiring.ts'), 'utf8')

    expect(composition).toContain(
      'googleReviewApi: integration.reviewSync.googleReviewApi',
    )
  })
})
