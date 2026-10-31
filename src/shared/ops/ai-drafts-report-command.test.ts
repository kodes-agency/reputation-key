import { describe, expect, it } from 'vitest'
import { parseDraftsReportArgs } from './ai-drafts-report-command'

describe('draft report filters', () => {
  it('accepts no filter or a concrete timestamp and Property', () => {
    expect(parseDraftsReportArgs([])).toEqual({})
    expect(
      parseDraftsReportArgs([
        '--since',
        '2026-10-31T00:00:00Z',
        '--property',
        '4f000000-0000-4000-8000-000000000001',
      ]),
    ).toEqual({
      since: '2026-10-31T00:00:00Z',
      propertyId: '4f000000-0000-4000-8000-000000000001',
    })
  })
  it.each([
    ['--since'],
    ['--since', 'yesterday'],
    ['--property', 'arbitrary text'],
    ['--text', 'draft'],
    ['--since', '2026-10-31T00:00:00Z', '--since', '2026-10-31T01:00:00Z'],
  ])('rejects invalid filters %j', (...args) => {
    expect(() => parseDraftsReportArgs(args)).toThrow(/Usage:|Invalid/)
  })
})
