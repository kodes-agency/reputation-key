import { describe, expect, it } from 'vitest'
import {
  portalQuietFact,
  portalReadiness,
  type PortalQuietInput,
  type PortalReadiness,
} from './goal-portal-readiness'

const READY: PortalReadiness = { live: true, codeMade: true, firstScan: true }

/** Spa on Nov 21: live 28 days with a scan a day, its last on Nov 15. */
const spa = (patch: Partial<PortalQuietInput> = {}): PortalQuietInput => ({
  today: '2026-11-21',
  readiness: READY,
  established: true,
  liveDays: 28,
  scans: 28,
  codeMadeOn: '2026-10-01',
  lastScanOn: '2026-11-15',
  ...patch,
})

describe('portal readiness', () => {
  it('marks each step from the facts: live, a code with its marker, a scan since', () => {
    const at = new Date('2026-10-09T09:00:00.000Z')

    expect(
      portalReadiness({
        liveSince: at,
        codeIssuedAt: at,
        codeReady: true,
        lastScanAt: at,
      }),
    ).toEqual({ live: true, codeMade: true, firstScan: true })
    expect(
      portalReadiness({
        liveSince: null,
        codeIssuedAt: at,
        codeReady: false,
        lastScanAt: null,
      }),
    ).toEqual({ live: false, codeMade: false, firstScan: false })
  })
})

describe('portal quiet facts', () => {
  it('no scans since Nov 15 when silent days × usual reach 5', () => {
    // Nov 16 to Nov 20 are five whole silent days at one scan a day.
    expect(portalQuietFact(spa())).toEqual({
      kind: 'no_scans_since',
      since: '2026-11-15',
      usualPerWeek: 7,
    })
  })

  it('stays quiet under 5 expected', () => {
    expect(portalQuietFact(spa({ today: '2026-11-20' }))).toBeNull()
    // Two scans a week: five silent days expect under 2.
    expect(portalQuietFact(spa({ scans: 8 }))).toBeNull()
    expect(portalQuietFact(spa({ lastScanOn: '2026-11-21' }))).toBeNull()
  })

  it('says nothing about a portal outside the rate or with no scans in it', () => {
    expect(portalQuietFact(spa({ established: false }))).toBeNull()
    expect(portalQuietFact(spa({ scans: 0 }))).toBeNull()
  })

  it('rounds the usual week half up', () => {
    // 13 scans in 28 days is 3.25 a week; 14 in 28 is 3.5, which rounds to 4.
    expect(
      portalQuietFact(spa({ scans: 13, today: '2026-11-27', lastScanOn: '2026-11-15' })),
    ).toMatchObject({ usualPerWeek: 3 })
    expect(
      portalQuietFact(spa({ scans: 14, today: '2026-11-27', lastScanOn: '2026-11-15' })),
    ).toMatchObject({ usualPerWeek: 4 })
  })

  it('no scan in the 17 days since its code was made', () => {
    const fact = portalQuietFact({
      today: '2026-10-23',
      readiness: { live: true, codeMade: true, firstScan: false },
      established: false,
      liveDays: 8,
      scans: 0,
      codeMadeOn: '2026-10-06',
      lastScanOn: null,
    })

    expect(fact).toEqual({ kind: 'no_scan_since_code', days: 17 })
  })

  it('a code under 14 days old says nothing', () => {
    const young = {
      today: '2026-10-23',
      readiness: { live: true, codeMade: true, firstScan: false },
      established: false,
      liveDays: 8,
      scans: 0,
      lastScanOn: null,
    } as const

    expect(portalQuietFact({ ...young, codeMadeOn: '2026-10-10' })).toBeNull()
    expect(portalQuietFact({ ...young, codeMadeOn: '2026-10-09' })).toEqual({
      kind: 'no_scan_since_code',
      days: 14,
    })
  })

  it('says nothing about a code no guest can reach', () => {
    const base = {
      today: '2026-10-23',
      established: false,
      liveDays: 0,
      scans: 0,
      codeMadeOn: '2026-10-01',
      lastScanOn: null,
    } as const

    expect(
      portalQuietFact({
        ...base,
        readiness: { live: false, codeMade: true, firstScan: false },
      }),
    ).toBeNull()
    expect(
      portalQuietFact({
        ...base,
        codeMadeOn: null,
        readiness: { live: true, codeMade: false, firstScan: false },
      }),
    ).toBeNull()
  })
})
