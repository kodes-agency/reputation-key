// BQC-0.4 — queue quarantine: pause/resume a BullMQ queue WITHOUT deleting jobs.
// The control must preserve every job (no obliterate/clean) so containment is
// reversible and evidence is kept.

import { describe, it, expect, vi } from 'vitest'
import {
  assertKnownQueueName,
  pauseQueueForQuarantine,
  resumeQueueFromQuarantine,
  queueQuarantineStatus,
  QUARANTINE_QUEUE_NAMES,
  type QuarantineQueuePort,
} from './queue-quarantine'

function makeQueue(
  counts: Record<string, number> = { waiting: 3, active: 1, failed: 2 },
) {
  const calls: string[] = []
  const queue: QuarantineQueuePort = {
    pause: vi.fn(async () => {
      calls.push('pause')
    }),
    resume: vi.fn(async () => {
      calls.push('resume')
    }),
    isPaused: vi.fn(async () => calls.includes('pause') && !calls.includes('resume')),
    getJobCounts: vi.fn(async () => counts),
    close: vi.fn(async () => {}),
  }
  return { queue, calls, counts }
}

describe('queue quarantine (BQC-0.4)', () => {
  it('pause stops processing and preserves every job', async () => {
    const { queue, counts } = makeQueue()
    const before = { ...counts }

    const result = await pauseQueueForQuarantine(queue)

    expect(queue.pause).toHaveBeenCalledTimes(1)
    expect(result.paused).toBe(true)
    // No job was deleted: counts are identical before and after pausing.
    expect(result.jobCounts).toEqual(before)
    expect(Object.values(result.jobCounts).reduce((a, b) => a + b, 0)).toBe(6)
  })

  it('resume restores processing without touching jobs', async () => {
    const { queue } = makeQueue()
    await pauseQueueForQuarantine(queue)

    const result = await resumeQueueFromQuarantine(queue)

    expect(queue.resume).toHaveBeenCalledTimes(1)
    expect(result.paused).toBe(false)
    expect(result.jobCounts).toEqual({ waiting: 3, active: 1, failed: 2 })
  })

  it('status reports pause state and job counts without mutating', async () => {
    const { queue } = makeQueue({ waiting: 5 })
    const status = await queueQuarantineStatus(queue)

    expect(status.paused).toBe(false)
    expect(status.jobCounts).toEqual({ waiting: 5 })
    expect(queue.pause).not.toHaveBeenCalled()
    expect(queue.resume).not.toHaveBeenCalled()
  })

  it('accepts only known queue names (fail closed on typos)', () => {
    for (const name of QUARANTINE_QUEUE_NAMES) {
      expect(() => assertKnownQueueName(name)).not.toThrow()
    }
    expect(() => assertKnownQueueName('defualt')).toThrow(/unknown queue/i)
    expect(() => assertKnownQueueName('')).toThrow(/unknown queue/i)
    expect(() => assertKnownQueueName('*')).toThrow(/unknown queue/i)
  })
})
