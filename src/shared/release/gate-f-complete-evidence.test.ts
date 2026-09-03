/**
 * REL-01-T11 — the end-to-end Gate F harness.
 *
 * Gate F says "a successful deploy without this complete evidence join cannot
 * substitute for Gate F". Until this file, that claim was only testable for
 * three of the eighteen keys: the other fifteen had no producer, so there was
 * nothing to build a bundle from and nothing to break.
 *
 * Every artifact here comes from a REAL producer function. The negative
 * controls therefore prove something specific: replacing gate N's artifact
 * with a generic `{"status":"passed"}` file makes the bundle fail AND names
 * gate N — which is exactly what an operator reading the CLI output needs.
 */

import { describe, expect, it } from 'vitest'
import {
  GATE_F_REQUIRED_APPROVAL_ROLES,
  gateFRequiredGateIdsFor,
  validateGateFEvidenceBundle,
} from './gate-f-evidence'
import {
  completeGateFBundle,
  completeGateFBundleReader,
  rehearsalCanaryArtifact,
  type CompleteGateFBundleOverrides,
} from './gate-f-complete-evidence.test-fixtures'
import { LIVE_EVIDENCE_PARSERS } from './live-evidence'
import { PROMOTION_READBACK_GATE_F_IDS } from './promotion-readback-evidence'

const GENERIC_PLACEHOLDER = '{"status":"passed"}\n'

const CLOSED_BETA_GATE_IDS = gateFRequiredGateIdsFor('closed-beta')
const ALL_GATE_IDS = gateFRequiredGateIdsFor('open-beta')

function validate(overrides: CompleteGateFBundleOverrides = {}) {
  const bundle = completeGateFBundle(overrides)
  return validateGateFEvidenceBundle(
    bundle.content,
    completeGateFBundleReader(bundle.files),
    bundle.options,
  )
}

function errorsOf(result: ReturnType<typeof validate>): string {
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.errors.join('\n')
}

describe('complete Gate F bundle', () => {
  it('validates when all sixteen closed-beta keys carry real producer output', () => {
    const result = validate()

    expect(result).toMatchObject({ ok: true })
  })

  it('has a producer for every required gate id', () => {
    // The deliverable this wave owes: no Gate F key may be left accepting
    // opaque bytes. Producers are the three wave-2 modules, the four
    // promotion read-back gates, and the eleven live-evidence importers.
    const wave2 = [
      'promotion.deployed_critical_journeys',
      'promotion.canary_window',
      'promotion.restore_rollback',
    ]
    const readback = Object.values(PROMOTION_READBACK_GATE_F_IDS)
    const live = Object.keys(LIVE_EVIDENCE_PARSERS)
    const covered = new Set([...wave2, ...readback, ...live])

    for (const gateId of ALL_GATE_IDS) {
      expect(covered.has(gateId)).toBe(true)
    }
    expect(covered.size).toBe(ALL_GATE_IDS.length)
  })
})

describe('per-gate negative controls', () => {
  it.each(CLOSED_BETA_GATE_IDS)(
    'names %s when its first artifact is a generic placeholder',
    (gateId) => {
      const errors = errorsOf(
        validate({ gateArtifacts: { [gateId]: GENERIC_PLACEHOLDER } }),
      )

      expect(errors).toContain(`gates.${gateId}.evidence.0`)
    },
  )
})

describe('approval negative controls', () => {
  it.each(GATE_F_REQUIRED_APPROVAL_ROLES)(
    'fails when the %s signature is removed',
    (role) => {
      const errors = errorsOf(validate({ posture: 'ga', unsignedRoles: [role] }))

      expect(errors).toContain(`approvals.${role}.evidence`)
      expect(errors).toContain('signature_invalid')
    },
  )

  it('fails closed when no verifier is supplied at all', () => {
    const bundle = completeGateFBundle()
    const result = validateGateFEvidenceBundle(
      bundle.content,
      completeGateFBundleReader(bundle.files),
      {
        legalRevisionSet: bundle.options.legalRevisionSet,
        legalDocuments: bundle.options.legalDocuments,
      },
    )

    expect(errorsOf(result)).toContain('no approval signature verifier was supplied')
  })
})

describe('release posture decides the approval set', () => {
  it('requires sixteen gates while closed and restores all eighteen when widened', () => {
    expect(CLOSED_BETA_GATE_IDS).toHaveLength(16)
    expect(CLOSED_BETA_GATE_IDS).toContain('candidate.clean_ci')
    expect(CLOSED_BETA_GATE_IDS).not.toContain('candidate.independent_review')
    expect(CLOSED_BETA_GATE_IDS).not.toContain('opening.cohort_readiness')
    expect(ALL_GATE_IDS).toHaveLength(18)
    expect(ALL_GATE_IDS).toContain('candidate.independent_review')
    expect(ALL_GATE_IDS).toContain('opening.cohort_readiness')
  })

  it('accepts a closed beta approved by the founder alone', () => {
    const result = validate({ posture: 'closed-beta' })

    expect(result.ok).toBe(true)
  })

  it('refuses a closed beta with no founder approval', () => {
    const errors = errorsOf(validate({ posture: 'closed-beta', approvalRoles: [] }))

    expect(errors).toContain('missing required Gate F approval founder')
  })

  it('refuses a closed beta that carries the full six, because the set is exact', () => {
    // Not "at least the founder". An exact set is what stops a bundle padding
    // itself with roles nobody independently holds.
    const errors = errorsOf(
      validate({ posture: 'closed-beta', approvalRoles: GATE_F_REQUIRED_APPROVAL_ROLES }),
    )

    expect(errors).toContain('must be exact for posture closed-beta')
  })

  it('refuses a founder-only approval that declares itself open to outsiders', () => {
    // The discriminating control: the narrowed set must be reachable ONLY by
    // declaring the narrow posture. If this passed, the posture field would be
    // decoration and any release could sign once.
    const errors = errorsOf(
      validate({ posture: 'open-beta', approvalRoles: ['founder'] }),
    )

    expect(errors).toContain('missing required Gate F approval counsel')
    expect(errors).toContain('must be exact for posture open-beta')
  })

  it('requires all six once the posture is general availability', () => {
    const errors = errorsOf(validate({ posture: 'ga', approvalRoles: ['founder'] }))

    expect(errors).toContain('missing required Gate F approval security')
  })
})

describe('legal and provenance negative controls', () => {
  it('fails when the legal approval expires before Gate F completes', () => {
    const errors = errorsOf(
      validate({ legalChecklistExpiresAt: '2026-08-28T11:59:00.000Z' }),
    )

    expect(errors).toContain('release.legalApprovalChecklist')
    expect(errors).toContain('expired')
  })

  it('fails when the canary artifact was produced against a rehearsal project', () => {
    // reputation-key-us-beta-rehearsal is a DIFFERENT Railway project by
    // policy. Rehearsal evidence relabelled as production evidence is the
    // cheapest possible way to fake a promotion.
    const base = completeGateFBundle()
    const errors = errorsOf(
      validate({
        gateArtifacts: {
          'promotion.canary_window': rehearsalCanaryArtifact(base.files),
        },
      }),
    )

    expect(errors).toContain('gates.promotion.canary_window.evidence.0')
    expect(errors).toContain('candidate.projectName')
  })
})
