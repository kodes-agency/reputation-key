import { afterEach, expect, it, vi } from 'vitest'
import {
  analysed,
  counted,
  harness,
  input,
} from '#/test-fixtures/guest-voice-read.test-fixtures'
import { loadGuestVoiceReadContext } from './guest-voice-read-context'
import * as joins from './guest-voice-v2-join'

afterEach(() => vi.restoreAllMocks())

it.each([undefined, false, true])(
  'joins history only when explicitly requested (%s)',
  async (withHistory) => {
    const historyJoin = vi.spyOn(joins, 'joinPeriod')
    const { deps } = harness({
      population: [counted(1, '2026-08-18')],
      facts: { reviews: [analysed(1, '2026-08-18')] },
    })
    const result = await loadGuestVoiceReadContext(
      deps,
      { ...input, range: '30d' },
      { withHistory },
    )
    if (result.status !== 'loaded') throw new Error('expected loaded context')
    expect(historyJoin).toHaveBeenCalledTimes(withHistory ? 1 : 0)
    expect(result.history.map((r) => r.reviewId)).toEqual(
      withHistory ? [counted(1, '2026-08-18').reviewId] : [],
    )
    expect(result.build.current).toHaveLength(1)
  },
)
