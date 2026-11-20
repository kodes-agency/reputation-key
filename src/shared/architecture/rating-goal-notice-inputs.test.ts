// Rating goal notices are decided from the goal's status alone. The forecast
// average blends new reviews in (`trackingMix`); reading it here would raise the
// notice volume that rating-goal-blend-volume.test.ts measures.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

describe('rating goal notice inputs', () => {
  it('reads the notices from the status alone, never from the forecast average', () => {
    const sources = [
      'src/contexts/reporting/rating-goals/rating-goal-evaluation.server.ts',
      'src/contexts/reporting/domain/rating-goal-notices.ts',
    ].map(read)

    expect(sources.map((source) => source.includes('trackingMix'))).toEqual([
      false,
      false,
    ])
  })
})
