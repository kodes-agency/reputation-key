import { describe, expect, it } from 'vitest'
import { googleApprovalGapDisposition } from './google-approval-gap'
import { CURRENT_RELEASE_POSTURE } from './release-posture'

describe('Google approval gap disposition', () => {
  it('wires the executor when an approval is usable', () => {
    for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
      expect(
        googleApprovalGapDisposition(
          { gatewayConfigured: true, approvalUsable: true },
          posture,
        ),
      ).toBe('wire')
    }
  })

  it('disables rather than refusing when no gateway is configured', () => {
    // Already the pre-existing behaviour: an unconfigured gateway leaves the
    // executor undefined at every posture. Pinned so the new branch cannot
    // accidentally turn a quiet no-op into a refusal.
    for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
      expect(
        googleApprovalGapDisposition(
          { gatewayConfigured: false, approvalUsable: false },
          posture,
        ),
      ).toBe('disable')
    }
  })

  describe('the gap this exists for', () => {
    it('keeps a closed beta running with the Google capability unavailable', () => {
      // The 2026-08-31 outage: the route catalogue moved to 2026-08-27, the
      // installed binding still pinned 2026-08-16, and createContainer threw.
      // worker could not start at all and every web server function failed.
      expect(
        googleApprovalGapDisposition(
          { gatewayConfigured: true, approvalUsable: false },
          'closed-beta',
        ),
      ).toBe('disable')
    })

    it('still refuses once the audience is wider than the owner', () => {
      for (const posture of ['open-beta', 'ga'] as const) {
        expect(
          googleApprovalGapDisposition(
            { gatewayConfigured: true, approvalUsable: false },
            posture,
          ),
        ).toBe('refuse')
      }
    })

    it('uses the declared posture when the caller does not pass one', () => {
      expect(CURRENT_RELEASE_POSTURE).toBe('closed-beta')
      expect(
        googleApprovalGapDisposition({ gatewayConfigured: true, approvalUsable: false }),
      ).toBe('disable')
    })
  })

  it('never wires without a usable approval', () => {
    // The property that must hold whatever the posture: this changes whether
    // the process STARTS, never whether an unapproved Google path can execute.
    for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
      for (const gatewayConfigured of [true, false]) {
        expect(
          googleApprovalGapDisposition(
            { gatewayConfigured, approvalUsable: false },
            posture,
          ),
        ).not.toBe('wire')
      }
    }
  })
})
