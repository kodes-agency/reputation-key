import { describe, expect, it } from 'vitest'
import { parseIntegrationDurations } from './record-integration-durations'

const line = (text: string) => `2026-11-21T17:56:02.3046791Z ${text}`

describe('parseIntegrationDurations', () => {
  it('reads each integration file line, in ms or s, rounded to 100 ms', () => {
    const log = [
      line(
        '\u001b[32m✓\u001b[39m \u001b[30m\u001b[45m integration \u001b[49m\u001b[39m src/a.integration.test.ts \u001b[2m(\u001b[22m\u001b[2m51 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 1470\u001b[2mms\u001b[22m\u001b[39m',
      ),
      line(' ✓  integration  src/b.integration.test.ts (1 test) 49ms'),
      line(' ❯  integration  src/c.integration.test.ts (12 tests | 1 failed) 2.5s'),
      line(' ✓  unit  src/d.test.ts (3 tests) 900ms'),
      line('stdout | src/a.integration.test.ts > some test'),
    ].join('\n')

    expect(parseIntegrationDurations(log)).toEqual({
      'src/a.integration.test.ts': 1_500,
      'src/b.integration.test.ts': 0,
      'src/c.integration.test.ts': 2_500,
    })
  })

  it('sorts by path so a re-record diffs line by line', () => {
    const log = [
      line(' ✓  integration  src/z.integration.test.ts (1 test) 300ms'),
      line(' ✓  integration  src/m.integration.test.ts (1 test) 200ms'),
    ].join('\n')
    expect(Object.keys(parseIntegrationDurations(log))).toEqual([
      'src/m.integration.test.ts',
      'src/z.integration.test.ts',
    ])
  })

  it('finds nothing in a log without integration lines', () => {
    expect(
      parseIntegrationDurations(line(' ✓  unit  src/d.test.ts (3 tests) 900ms')),
    ).toEqual({})
  })
})
