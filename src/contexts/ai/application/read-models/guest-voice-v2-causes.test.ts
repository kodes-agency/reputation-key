import { expect, it } from 'vitest'
import { causeCounts } from './guest-voice-v2-causes'
import { tallyIssues } from './guest-voice-v2-tally'
import { ISSUE, mention, review } from './guest-voice-v2.test-fixtures'

it('counts each normalized cause once per review and sense, including ties', () => {
  const tallies = tallyIssues([
    review(1, {
      mentions: [
        mention(),
        mention({ cause: ' Musty Smell ' }),
        mention({ cause: 'worn furniture' }),
        mention({ polarity: 'positive', cause: 'musty smell' }),
      ],
    }),
    review(2, { mentions: [mention({ cause: 'worn furniture' })] }),
  ])
  expect(causeCounts(tallies.get(`${ISSUE}:complaint`)!)).toEqual([
    { cause: 'worn furniture', reviewCount: 2 },
    { cause: 'musty smell', reviewCount: 1 },
  ])
  expect(causeCounts(tallies.get(`${ISSUE}:praise`)!)).toEqual([
    { cause: 'musty smell', reviewCount: 1 },
  ])
})
