import { describe, expect, it } from 'vitest'
import { urgentAlertEventId } from './ai-urgent-alert'

const REVISION = {
  organizationId: 'org-1',
  propertyId: '71000000-0000-4000-8000-000000000201',
  reviewId: '71000000-0000-4000-8000-000000000203',
  sourceEpoch: 0,
  sourceRevision: 1,
} as const

describe('the Urgent alert fact id', () => {
  it('is a version-5 UUID, so the outbox can hold it in its id column', () => {
    expect(urgentAlertEventId(REVISION)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('is the same for the same review revision, whatever analysis found it', () => {
    expect(urgentAlertEventId({ ...REVISION })).toBe(urgentAlertEventId(REVISION))
  })

  it.each([
    ['another Organization', { organizationId: 'org-2' }],
    ['another Property', { propertyId: '71000000-0000-4000-8000-000000000299' }],
    ['another review', { reviewId: '71000000-0000-4000-8000-000000000298' }],
    ['another source epoch', { sourceEpoch: 1 }],
    ['another revision of the review', { sourceRevision: 2 }],
  ])('differs for %s', (_label, change) => {
    expect(urgentAlertEventId({ ...REVISION, ...change })).not.toBe(
      urgentAlertEventId(REVISION),
    )
  })

  it('does not run two fields together', () => {
    // 1 + 11 and 11 + 1 would read the same without a separator.
    expect(
      urgentAlertEventId({ ...REVISION, sourceEpoch: 1, sourceRevision: 11 }),
    ).not.toBe(urgentAlertEventId({ ...REVISION, sourceEpoch: 11, sourceRevision: 1 }))
  })
})
