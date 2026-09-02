import { describe, expect, it } from 'vitest'
import { googleContentSigningScope } from './google-content-signing-scope'
import { GOOGLE_CONTENT_CAPABILITIES } from '#/shared/auth/google-content-contract'

/** What the live closed-beta database actually holds, verified 2026-09-01. */
const CLOSED_BETA_ROWS = [
  'property.import_gbp_v2',
  'property.read_gbp_performance',
] as const

describe('Google Content signing scope', () => {
  it('re-signs the two capabilities the closed beta actually approved', () => {
    // The blocker this removes: the signer refused with "no approval row to
    // re-sign for: property.connect_gbp, property.publish_reply", so a route
    // catalogue bump could take Google down with no way to re-sign.
    const scope = googleContentSigningScope(CLOSED_BETA_ROWS, 'closed-beta')
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.capabilities).toEqual([
      'property.import_gbp_v2',
      'property.read_gbp_performance',
    ])
  })

  it('still demands the complete set once the audience widens', () => {
    for (const posture of ['open-beta', 'ga'] as const) {
      const scope = googleContentSigningScope(CLOSED_BETA_ROWS, posture)
      expect(scope.ok).toBe(false)
      if (scope.ok) return
      expect(scope.reason).toContain('property.connect_gbp')
      expect(scope.reason).toContain('property.publish_reply')
    }
  })

  it('accepts the complete set at every posture', () => {
    for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
      const scope = googleContentSigningScope([...GOOGLE_CONTENT_CAPABILITIES], posture)
      expect(scope.ok).toBe(true)
      if (!scope.ok) return
      expect(scope.capabilities).toEqual([...GOOGLE_CONTENT_CAPABILITIES])
    }
  })

  it('refuses an empty set at every posture', () => {
    // The one case that is not about audience: re-signing nothing means being
    // asked to sign something that was never approved.
    for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
      const scope = googleContentSigningScope([], posture)
      expect(scope.ok).toBe(false)
      if (scope.ok) return
      expect(scope.reason).toContain('cannot create one')
    }
  })

  it('never returns a capability that has no approval row', () => {
    // The property that must hold whatever the posture: this widens WHICH
    // existing approvals get refreshed, never invents one.
    for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
      const scope = googleContentSigningScope(['property.import_gbp_v2'], posture)
      if (!scope.ok) continue
      expect(scope.capabilities).toEqual(['property.import_gbp_v2'])
    }
  })

  it('introduces a capability that has never been approved', () => {
    // The gap this closes: `property.connect_gbp` gates review sync and
    // `property.publish_reply` gates reply publication, and neither could ever
    // be approved here because the scope was drawn only from rows that already
    // existed. Unreachable by construction rather than by decision.
    const scope = googleContentSigningScope(CLOSED_BETA_ROWS, 'closed-beta', [
      'property.connect_gbp',
    ])
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.capabilities).toEqual([
      'property.import_gbp_v2',
      'property.read_gbp_performance',
      'property.connect_gbp',
    ])
  })

  it('refuses to introduce a capability that is already approved', () => {
    // That is a refresh, and a refresh must not silently become an
    // introduction — the two carry different intent.
    const scope = googleContentSigningScope(CLOSED_BETA_ROWS, 'closed-beta', [
      'property.import_gbp_v2',
    ])
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.reason).toContain('already approved')
    expect(scope.reason).toContain('property.import_gbp_v2')
  })

  it('refuses a name that is not a contract capability', () => {
    const scope = googleContentSigningScope(CLOSED_BETA_ROWS, 'closed-beta', [
      'property.invent_something',
    ])
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.reason).toContain('not a Google Content capability')
  })

  it('can introduce the first approval into an empty set', () => {
    // An empty set is refused only when nothing is being introduced either:
    // the refusal is about signing something never approved, not about the
    // count of existing rows.
    const scope = googleContentSigningScope([], 'closed-beta', ['property.publish_reply'])
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.capabilities).toEqual(['property.publish_reply'])
  })

  it('returns introduced capabilities in contract order, not argument order', () => {
    const scope = googleContentSigningScope([], 'closed-beta', [
      'property.publish_reply',
      'property.import_gbp_v2',
    ])
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.capabilities).toEqual([
      'property.import_gbp_v2',
      'property.publish_reply',
    ])
  })

  it('ignores rows for names that are not Google Content capabilities', () => {
    const scope = googleContentSigningScope(
      ['property.import_gbp_v2', 'not.a.capability'],
      'closed-beta',
    )
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.capabilities).toEqual(['property.import_gbp_v2'])
  })

  it('returns capabilities in the contract order, not the row order', () => {
    const scope = googleContentSigningScope(
      ['property.read_gbp_performance', 'property.import_gbp_v2'],
      'closed-beta',
    )
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.capabilities).toEqual([
      'property.import_gbp_v2',
      'property.read_gbp_performance',
    ])
  })
})
