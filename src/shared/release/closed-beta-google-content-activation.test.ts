import { describe, expect, it } from 'vitest'
import {
  activateClosedBetaGoogleContent,
  type ClosedBetaBundleView,
} from './closed-beta-google-content-activation'

/**
 * A view over the fields this module reads.
 *
 * Deliberately not a real `GoogleContentApprovalBundle`: signature, digest and
 * expiry checking belong to `validateGoogleContentApprovalBundle`, which the
 * caller runs first and which has its own suite. Building real Ed25519 material
 * and self-consistent evidence digests here would test that module twice and
 * this one not at all.
 */
const view = (
  overrides: Record<string, unknown> = {},
  owner = 'owner-1',
): ClosedBetaBundleView => ({
  binding: {
    capability: 'property.import_gbp_v2',
    targetPhase: 'railway_closed_beta',
    environmentProfile: 'railway-closed-beta-1',
    releaseSha: 'b'.repeat(40),
    evidenceManifestSha256: 'a'.repeat(64),
    evidenceIndexSha256: 'c'.repeat(64),
    routeCatalogueVersion: '2026-08-27',
    migrationHead: 'head',
    approvedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-30T00:00:00.000Z',
    status: 'approved',
    ...overrides,
  },
  approverIdentities: [owner],
})

describe('closed-beta Google Content activation', () => {
  describe('posture is the whole point', () => {
    it.each(['open-beta', 'ga'] as const)('refuses at %s', (posture) => {
      const outcome = activateClosedBetaGoogleContent([view()], posture)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.code).toBe('posture_refused')
      // The message must point at the governed path, not just say no: this is
      // the one place someone could mistake a narrow tool for the real one.
      expect(outcome.detail).toContain('cell-us')
    })

    it('accepts at closed-beta', () => {
      const outcome = activateClosedBetaGoogleContent([view()], 'closed-beta')
      expect(outcome.ok).toBe(true)
    })
  })

  describe('set-level integrity', () => {
    it('mirrors the runtime schema by accepting a subset of capabilities', () => {
      // The production installer demands all four because all four are in scope
      // for the production cell. The runtime marks each optional and requires
      // one; the closed beta has approval rows for two. Requiring four here
      // would make the path unusable for the posture it exists to serve.
      const outcome = activateClosedBetaGoogleContent(
        [view(), view({ capability: 'property.read_gbp_performance' })],
        'closed-beta',
      )
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.capabilities).toEqual([
        'property.import_gbp_v2',
        'property.read_gbp_performance',
      ])
    })

    it('refuses bundles from two different signing runs', () => {
      const outcome = activateClosedBetaGoogleContent(
        [
          view(),
          view({
            capability: 'property.read_gbp_performance',
            releaseSha: 'f'.repeat(40),
          }),
        ],
        'closed-beta',
      )
      expect(outcome).toMatchObject({ ok: false, code: 'mixed_deployments' })
    })

    it('refuses two owners', () => {
      const outcome = activateClosedBetaGoogleContent(
        [
          view({}, 'owner-1'),
          view({ capability: 'property.read_gbp_performance' }, 'owner-2'),
        ],
        'closed-beta',
      )
      expect(outcome).toMatchObject({ ok: false, code: 'mixed_owners' })
    })

    it('refuses the same capability twice', () => {
      const outcome = activateClosedBetaGoogleContent([view(), view()], 'closed-beta')
      expect(outcome).toMatchObject({ ok: false, code: 'duplicate_capability' })
    })

    it('refuses a set that pins two route catalogues', () => {
      // This is the exact drift that broke the beta: a binding pinned
      // 2026-08-16 while the compiled code required 2026-08-27. A set that
      // disagrees with itself must never be installable.
      const outcome = activateClosedBetaGoogleContent(
        [
          view(),
          view({
            capability: 'property.read_gbp_performance',
            routeCatalogueVersion: '2026-08-16',
          }),
        ],
        'closed-beta',
      )
      expect(outcome).toMatchObject({ ok: false, code: 'mixed_route_catalogues' })
    })

    it('refuses an empty set rather than writing an empty binding map', () => {
      expect(activateClosedBetaGoogleContent([], 'closed-beta')).toMatchObject({
        ok: false,
        code: 'no_bundles',
      })
    })

    it('refuses approvals aimed at another phase', () => {
      const outcome = activateClosedBetaGoogleContent(
        [view({ targetPhase: 'production' })],
        'closed-beta',
      )
      expect(outcome).toMatchObject({ ok: false, code: 'wrong_target_phase' })
    })
  })

  describe('the value it produces', () => {
    it('drops the approval window the runtime never reads', () => {
      const outcome = activateClosedBetaGoogleContent([view()], 'closed-beta')
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      const parsed = JSON.parse(outcome.runtimeBindingsJson) as Record<
        string,
        Record<string, unknown>
      >
      const entry = parsed['property.import_gbp_v2']
      expect(entry).toBeDefined()
      expect(entry).not.toHaveProperty('approvedAt')
      expect(entry).not.toHaveProperty('expiresAt')
      expect(entry).not.toHaveProperty('status')
      expect(entry?.routeCatalogueVersion).toBe('2026-08-27')
    })

    it('reports the window the whole set shares', () => {
      // Not a minimum over rivals: the signer stamps one window across a run,
      // and a set that disagrees is already refused as a mixed deployment.
      const outcome = activateClosedBetaGoogleContent(
        [view(), view({ capability: 'property.read_gbp_performance' })],
        'closed-beta',
      )
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.expiresAt).toBe('2026-09-30T00:00:00.000Z')
    })

    it('surfaces the route catalogue so a stale set is visible before install', () => {
      const outcome = activateClosedBetaGoogleContent([view()], 'closed-beta')
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.routeCatalogueVersion).toBe('2026-08-27')
    })
  })
})
