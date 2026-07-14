// Tests for JobRuntime validation (PRE17A A2).
// Verifies that duplicate job names, duplicate scheduler IDs, and missing
// handlers fail at startup.

import { describe, it, expect } from 'vitest'
import { createJobRuntime } from './runtime'
import type { JobDefinition } from './contracts'
import type { JobHandler } from './registry'

const noopHandler: JobHandler = async () => {}

function makeDef(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    owner: 'test',
    name: 'test.job',
    queue: 'background',
    handler: noopHandler,
    retry: 'standard',
    redisRequired: true,
    content: 'identifier-only',
    ...overrides,
  }
}

describe('JobRuntime validation', () => {
  it('accepts valid definitions', () => {
    expect(() =>
      createJobRuntime([makeDef({ name: 'job.a' }), makeDef({ name: 'job.b' })]),
    ).not.toThrow()
  })

  it('rejects duplicate job names', () => {
    expect(() =>
      createJobRuntime([
        makeDef({ name: 'job.dup', owner: 'context-a' }),
        makeDef({ name: 'job.dup', owner: 'context-b' }),
      ]),
    ).toThrow(/Duplicate job name "job\.dup"/)
  })

  it('rejects duplicate scheduler IDs', () => {
    expect(() =>
      createJobRuntime([
        makeDef({
          name: 'job.a',
          schedule: { schedulerId: 'recurring-1', every: 60_000 },
        }),
        makeDef({
          name: 'job.b',
          schedule: { schedulerId: 'recurring-1', every: 120_000 },
        }),
      ]),
    ).toThrow(/Duplicate scheduler ID "recurring-1"/)
  })

  it('rejects schedule without pattern or every', () => {
    expect(() =>
      createJobRuntime([
        makeDef({
          name: 'job.bad',
          schedule: { schedulerId: 'bad-1' },
        }),
      ]),
    ).toThrow(/must have either pattern or every/)
  })

  it('accepts unique scheduler IDs', () => {
    expect(() =>
      createJobRuntime([
        makeDef({
          name: 'job.a',
          schedule: { schedulerId: 'sched-a', every: 60_000 },
        }),
        makeDef({
          name: 'job.b',
          schedule: { schedulerId: 'sched-b', pattern: '0 * * * *' },
        }),
      ]),
    ).not.toThrow()
  })
})
