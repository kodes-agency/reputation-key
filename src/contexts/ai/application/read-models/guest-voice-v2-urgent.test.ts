import { expect, it } from 'vitest'
import { assembleGuestVoiceV2 } from './guest-voice-v2-build'
import { buildGuestVoiceDetail } from './guest-voice-v2-details'
import { ISSUE, OTHER, input, mention, review } from './guest-voice-v2.test-fixtures'

it('shares collision-safe complaint titles across urgent rows, ranked rows and issue detail', () => {
  const current = [ISSUE, OTHER].flatMap((id, i) =>
    [1, 2, 3].map((n) =>
      review(i * 3 + n, {
        urgentReason: 'health',
        mentions: [mention({ issueGroupId: id })],
      }),
    ),
  )
  const build = input(current)
  const read = assembleGuestVoiceV2(build).read
  expect(read.urgent.map((r) => r.title)).toEqual(read.fixFirst.map((r) => r.title))
  expect(read.urgent.map((r) => r.title)).toEqual([
    'Room — musty smell (Cleanliness) · 00000001',
    'Room — musty smell (Cleanliness) · 00000002',
  ])
  const detail = buildGuestVoiceDetail({
    build,
    history: current,
    historyStartLocalDate: build.startLocalDate,
    target: { kind: 'issue', issueId: ISSUE, sense: 'complaint' },
  })
  expect(detail?.read.drawer).toMatchObject({ title: read.urgent[0]?.title })
})
