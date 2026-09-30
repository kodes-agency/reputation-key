import { describe, expect, it } from 'vitest'
import { portalFunnelPresentation as presentFunnel } from './portal-funnel-presentation'
import type { PortalEngagementFunnel } from '#/contexts/reporting/application/public-api'

// The registry's first day for qualified scans, as the server hands it over.
const SINCE = new Date('2026-08-01T00:00:00.000Z')
const portalFunnelPresentation = (funnel: PortalEngagementFunnel) =>
  presentFunnel(funnel, SINCE)

describe('portalFunnelPresentation', () => {
  it('draws a chart with each step as a share of the step before it', () => {
    const funnel = portalFunnelPresentation({
      qualifiedScans: 200,
      ratings: 50,
      googleOpens: 10,
    })

    expect(funnel.mode).toBe('chart')
    expect(funnel.note).toBeNull()
    expect(
      funnel.stages.map(({ key, actual, conversion }) => ({ key, actual, conversion })),
    ).toEqual([
      { key: 'qualifiedScans', actual: 200, conversion: null },
      { key: 'ratings', actual: 50, conversion: 25 },
      { key: 'googleOpens', actual: 10, conversion: 20 },
    ])
  })

  it('shows counts only, never a percentage over 100, when ratings out-count scans', () => {
    // Qualified scans exist only from August 2026, so an earlier window can
    // hold more ratings than scans. Real data, not a rendering bug.
    const funnel = portalFunnelPresentation({
      qualifiedScans: 3,
      ratings: 7,
      googleOpens: 5,
    })

    expect(funnel.mode).toBe('counts_only')
    expect(funnel.stages.map((stage) => stage.actual)).toEqual([3, 7, 5])
    expect(funnel.stages.every((stage) => stage.conversion === null)).toBe(true)
    // The date is the server's, formatted from the value, not a copy literal.
    expect(funnel.note).toContain('Aug 1, 2026')
    expect(funnel.note).toContain('rate without a counted scan')
    expect(funnel.note).toContain('without percentages')
  })

  it('takes the note date from the value it is given', () => {
    const funnel = presentFunnel(
      { qualifiedScans: 3, ratings: 7, googleOpens: 5 },
      new Date('2027-01-15T00:00:00.000Z'),
    )
    expect(funnel.note).toContain('Jan 15, 2027')
    expect(funnel.note).not.toContain('Aug 1, 2026')
  })

  it('counts a later step that out-counts an earlier one as the same condition', () => {
    const funnel = portalFunnelPresentation({
      qualifiedScans: 40,
      ratings: 8,
      googleOpens: 9,
    })

    expect(funnel.mode).toBe('counts_only')
    expect(funnel.stages.every((stage) => stage.conversion === null)).toBe(true)
  })

  it('explains a Google-opens inversion without blaming qualified scans', () => {
    const funnel = portalFunnelPresentation({
      qualifiedScans: 40,
      ratings: 8,
      googleOpens: 9,
    })

    expect(funnel.note).toContain('more guests opened Google than left a private rating')
    expect(funnel.note).not.toContain('Qualified scans are counted from')
    expect(funnel.note).not.toContain('Aug 1, 2026')
    expect(funnel.note).toContain('without percentages')
  })

  it('names the scans reason first when both steps are inverted', () => {
    const funnel = portalFunnelPresentation({
      qualifiedScans: 2,
      ratings: 8,
      googleOpens: 9,
    })
    expect(funnel.note).toContain('Qualified scans are counted from Aug 1, 2026')
  })

  it('treats ratings with no qualified scans at all as counts only, not as empty', () => {
    const funnel = portalFunnelPresentation({
      qualifiedScans: 0,
      ratings: 4,
      googleOpens: 0,
    })

    expect(funnel.mode).toBe('counts_only')
    expect(funnel.stages.map((stage) => stage.actual)).toEqual([0, 4, 0])
  })

  it('reports an all-zero funnel as empty', () => {
    expect(
      portalFunnelPresentation({ qualifiedScans: 0, ratings: 0, googleOpens: 0 }).mode,
    ).toBe('empty')
  })

  it('leaves a share unstated when the step before it is zero', () => {
    const funnel = portalFunnelPresentation({
      qualifiedScans: 9,
      ratings: 0,
      googleOpens: 0,
    })

    expect(funnel.mode).toBe('chart')
    expect(funnel.stages.map((stage) => stage.conversion)).toEqual([null, 0, null])
  })

  it('names each step with the noun that goes after its number', () => {
    const [scans, ratings, opens] = portalFunnelPresentation({
      qualifiedScans: 1,
      ratings: 1,
      googleOpens: 1,
    }).stages

    expect([scans?.singular, ratings?.singular, opens?.singular]).toEqual([
      'qualified scan',
      'private rating',
      'Google open',
    ])
    expect([scans?.plural, ratings?.plural, opens?.plural]).toEqual([
      'qualified scans',
      'private ratings',
      'Google opens',
    ])
  })
})
