import { describe, expect, it } from 'vitest'
import { draftEditMetricDto } from './reply-read'
const identity = {
  generationId: '4f000000-0000-4000-8000-000000000001',
  replyId: '4f000000-0000-4000-8000-000000000002',
  replyRevision: 1,
}
describe('advisory submit metric DTO', () => {
  it('admits only bounded scalars or an explicitly unavailable baseline', () => {
    for (const distance of [0, 0.5, 1, null])
      expect(draftEditMetricDto.parse({ ...identity, distance })).toEqual({
        ...identity,
        distance,
      })
    expect(
      draftEditMetricDto.parse({ ...identity, generationId: null, distance: null })
        .generationId,
    ).toBeNull()
  })
  it('rejects arbitrary text, unsafe revisions and unbounded distances', () => {
    for (const distance of [-0.1, 1.1, Infinity, NaN])
      expect(draftEditMetricDto.safeParse({ ...identity, distance }).success).toBe(false)
    expect(
      draftEditMetricDto.safeParse({
        ...identity,
        distance: 0,
        draft: 'PRIVATE BASELINE',
      }).success,
    ).toBe(false)
    expect(
      draftEditMetricDto.safeParse({
        ...identity,
        replyRevision: Number.MAX_SAFE_INTEGER + 1,
        distance: 0,
      }).success,
    ).toBe(false)
  })
})
