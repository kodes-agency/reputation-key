import { describe, expect, it } from 'vitest'
import type { Job } from 'bullmq'
import { isScheduleFiring } from './schedule-firing'

function job(over: Record<string, unknown>): Job {
  return { name: 'health-check', data: {}, opts: {}, ...over } as unknown as Job
}

describe('isScheduleFiring', () => {
  it('recognises a Job Scheduler firing by its scheduler key', () => {
    expect(
      isScheduleFiring(
        job({
          id: 'repeat:health-check-recurring:1791090138172',
          repeatJobKey: 'health-check-recurring',
        }),
      ),
    ).toBe(true)
  })

  it('recognises a legacy repeat firing by its stable job id', () => {
    expect(isScheduleFiring(job({ id: 'health-check-recurring' }))).toBe(true)
    expect(
      isScheduleFiring(job({ id: '17', opts: { jobId: 'health-check-recurring' } })),
    ).toBe(true)
  })

  it('treats on-demand work as not a firing, whatever its id', () => {
    expect(isScheduleFiring(job({ id: '1196' }))).toBe(false)
    expect(isScheduleFiring(job({ id: 'ai-trend-schedule-1' }))).toBe(false)
    expect(isScheduleFiring(job({}))).toBe(false)
  })
})
