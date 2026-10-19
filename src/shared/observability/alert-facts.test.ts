import { describe, expect, it } from 'vitest'
import { alertFactTags } from './alert-facts'

describe('alertFactTags', () => {
  it('has no tags for an alert without facts', () => {
    expect(alertFactTags(undefined)).toEqual({})
    expect(alertFactTags({})).toEqual({})
    expect(alertFactTags({ jobs: [], reasons: [], codes: {} })).toEqual({})
  })

  it('names the job families, the reasons and the counts', () => {
    expect(
      alertFactTags({
        jobs: ['sync-property-reviews', 'discover-new-reviews'],
        reasons: ['repair_required', 'dead_letter_present'],
        codes: { source_changed: 1, provider_failure: 3 },
        count: 4,
      }),
    ).toEqual({
      alert_jobs: 'discover-new-reviews,sync-property-reviews',
      alert_reasons: 'dead_letter_present,repair_required',
      alert_codes: 'provider_failure:3,source_changed:1',
      alert_count: '4',
    })
  })

  it('lists each job and reason once', () => {
    expect(
      alertFactTags({
        jobs: ['a-job', 'a-job'],
        reasons: ['repair_required', 'repair_required'],
      }),
    ).toEqual({ alert_jobs: 'a-job', alert_reasons: 'repair_required' })
  })

  it('orders codes by how many there are, then by name', () => {
    expect(
      alertFactTags({ codes: { b_code: 1, a_code: 1, c_code: 5 } }).alert_codes,
    ).toBe('c_code:5,a_code:1,b_code:1')
  })

  it('drops a job or reason that is not shaped like a machine name', () => {
    expect(
      alertFactTags({
        jobs: ['sync-property-reviews', 'a job with spaces', 'guest@example.invalid'],
        reasons: ['repair_required', 'Review text: "great place"', ''],
      }),
    ).toEqual({
      alert_jobs: 'sync-property-reviews',
      alert_reasons: 'repair_required',
    })
  })

  it('counts a code that is not shaped like a machine name as other', () => {
    expect(
      alertFactTags({
        codes: { provider_failure: 1, 'free text from a row': 2, 'another one': 3 },
      }).alert_codes,
    ).toBe('other:5,provider_failure:1')
  })

  it('leaves a count out unless it is a whole number of at least zero', () => {
    expect(alertFactTags({ count: 0 })).toEqual({ alert_count: '0' })
    expect(alertFactTags({ count: -1 })).toEqual({})
    expect(alertFactTags({ count: 1.5 })).toEqual({})
    expect(alertFactTags({ count: Number.NaN })).toEqual({})
    expect(alertFactTags({ count: Number.POSITIVE_INFINITY })).toEqual({})
  })

  it('leaves a code count out unless it is a positive whole number', () => {
    expect(
      alertFactTags({ codes: { zero: 0, negative: -2, fraction: 0.5, real: 2 } })
        .alert_codes,
    ).toBe('real:2')
  })

  it('ignores a list that is not a list', () => {
    expect(alertFactTags({ jobs: 'sync-property-reviews' as never })).toEqual({})
  })

  it('keeps a list of a thousand entries within a tag', () => {
    const jobs = Array.from({ length: 1500 }, (_, index) => `job-${index}`)

    const tag = alertFactTags({ jobs }).alert_jobs ?? ''

    expect(tag.length).toBeLessThanOrEqual(200)
    expect(Number(tag.slice(tag.lastIndexOf('+') + 1))).toBeGreaterThan(1000)
  })

  it('keeps a long list within a tag, saying how many it left out', () => {
    const jobs = Array.from({ length: 30 }, (_, index) => `job-family-number-${index}`)

    const tag = alertFactTags({ jobs }).alert_jobs ?? ''

    expect(tag.length).toBeLessThanOrEqual(200)
    expect(tag).toMatch(/,\+\d+$/u)
    const listed = tag.split(',').filter((entry) => !entry.startsWith('+')).length
    const omitted = Number(tag.slice(tag.lastIndexOf('+') + 1))
    expect(listed + omitted).toBe(jobs.length)
  })
})
