import { describe, expect, it } from 'vitest'
import {
  DIRECT_PORTAL_FIXTURE,
  E2E_PORTAL_IDS,
  P1_PORTAL_FIXTURE,
  P2_PORTAL_FIXTURE,
  P3_PORTAL_FIXTURE,
} from './e2e-portal-fixtures'

describe('seeded guest journeys', () => {
  it('keeps the usual Portals rating-enabled and the direct fixture independent', () => {
    const usual = [P1_PORTAL_FIXTURE, P2_PORTAL_FIXTURE, P3_PORTAL_FIXTURE]
    expect(usual.map((portal) => portal.skipPrivateRating ?? false)).toEqual([
      false,
      false,
      false,
    ])
    expect(DIRECT_PORTAL_FIXTURE.skipPrivateRating).toBe(true)
    const all = [...usual, DIRECT_PORTAL_FIXTURE]
    for (const key of [
      'id',
      'tokenId',
      'snapshotId',
      'activationId',
      'tokenByte',
    ] as const) {
      expect(new Set(all.map((portal) => portal[key])).size).toBe(all.length)
    }
    expect(P1_PORTAL_FIXTURE.id).toBe(E2E_PORTAL_IDS.p1Portal)
  })
})
