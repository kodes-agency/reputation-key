// Turning signed Google Content approval bundles into the runtime bindings
// value, for the closed beta only.
//
// WHY THIS EXISTS. `scripts/release/railway-google-content-approval-activation.ts`
// is the governed installer, and it is correct — for the target it was written
// for. It addresses exactly one place: project `reputation-key-us-beta`,
// environment `cell-us`, checked against the canonical single-US foundation
// readback ("This command only ever addresses the single production cell-us
// environment", line 211). The closed beta does not run there, so a perfectly
// valid signed bundle could not be installed at all — `ops:google-content-approval-sign`
// would produce bundles nothing could consume, which is exactly the state the
// beta was found in.
//
// Loosening the production controller to accept a second target was the wrong
// fix: its foundation readback is a real release control, the closed beta has a
// different service set, and widening it would weaken the check that guards the
// production cell in order to serve a posture that is not it.
//
// So this is a SEPARATE, NARROWER path that refuses at any posture but
// `closed-beta`. Signature, digest and expiry checking are NOT re-implemented
// here — the caller runs `validateGoogleContentApprovalBundle` (the same
// validator the production installer uses) on every bundle first, and passes
// the results in. What this module owns is the SET-level reasoning: one
// deployment, one owner, one route catalogue, no duplicate capability.
//
// It reads only what it needs. That keeps it testable without minting real
// Ed25519 material or self-consistent evidence digests, and it means a change
// to an unrelated part of the bundle schema cannot silently change this rule.
//
// The one place it is deliberately laxer than the production installer is the
// capability set. That installer requires all four bundles because all four are
// in scope for the production cell. The RUNTIME schema
// (`google-content-runtime-bindings.ts`) marks each capability optional and
// requires only that at least one is present — and the closed beta has approval
// rows for two. Mirroring the runtime rather than the production installer is
// what makes this usable without asserting approvals that do not exist.

import { canonicalGoogleContentSha256 } from '#/shared/auth/google-content-approval'
import { isGoogleContentCapability } from '#/shared/auth/google-content-contract'
import { CURRENT_RELEASE_POSTURE, type ReleasePosture } from './release-posture'

/** The two variables an activation writes, in the order the runtime reads them. */
export const CLOSED_BETA_GOOGLE_CONTENT_VARIABLES = Object.freeze([
  'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON',
  'GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON',
] as const)

/**
 * The minimum this module reads from an already-validated bundle.
 *
 * Structural rather than the full `GoogleContentApprovalBundle`: everything
 * else in that type is the caller's business, and depending on it here would
 * make this rule impossible to test without real signing material.
 */
export type ClosedBetaBundleView = Readonly<{
  binding: Readonly<Record<string, unknown>> &
    Readonly<{
      capability: string
      targetPhase: string
      environmentProfile: string
      routeCatalogueVersion: string
      expiresAt: string
    }>
  /** Every role document's approver, so a mixed-owner set can be refused. */
  approverIdentities: readonly string[]
}>

export type ClosedBetaActivationRefusal = Readonly<{
  ok: false
  code: string
  detail: string
}>

export type ClosedBetaActivationResult = Readonly<{
  ok: true
  /** Capabilities this activation binds, sorted. */
  capabilities: readonly string[]
  /** The route catalogue every bundle agrees on — the value that goes stale. */
  routeCatalogueVersion: string
  /** Earliest expiry across the set: when this activation stops resolving. */
  expiresAt: string
  /** `GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON` value, ready to set. */
  runtimeBindingsJson: string
}>

export type ClosedBetaActivationOutcome =
  ClosedBetaActivationResult | ClosedBetaActivationRefusal

function refuse(code: string, detail: string): ClosedBetaActivationRefusal {
  return Object.freeze({ ok: false as const, code, detail })
}

/**
 * Every field a bundle shares with its siblings — capability and the two
 * per-capability evidence digests removed.
 *
 * Same construction the production installer uses: all bundles in one
 * activation must describe ONE deployment, so a set assembled from two separate
 * signing runs is refused rather than silently mixed.
 */
function commonFingerprint(view: ClosedBetaBundleView): string {
  const {
    capability: _capability,
    evidenceManifestSha256: _manifest,
    evidenceIndexSha256: _index,
    ...common
  } = view.binding
  return canonicalGoogleContentSha256(common)
}

/** The runtime value drops the approval window; the runtime never reads it. */
function runtimeBinding(view: ClosedBetaBundleView): Record<string, unknown> {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = view.binding
  return runtime
}

/**
 * Check a signed bundle set and derive the runtime bindings value.
 *
 * The caller MUST have run `validateGoogleContentApprovalBundle` on every
 * bundle already: this decides nothing about signatures or expiry windows.
 *
 * @param posture injected so tests can prove the refusal at every wider
 *   posture; production passes nothing and gets the declared one.
 */
export function activateClosedBetaGoogleContent(
  bundles: readonly ClosedBetaBundleView[],
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
): ClosedBetaActivationOutcome {
  if (posture !== 'closed-beta') {
    return refuse(
      'posture_refused',
      `this path exists only for closed-beta; at ${posture} use the governed cell-us activation controller`,
    )
  }
  if (bundles.length === 0) {
    return refuse('no_bundles', 'at least one signed bundle is required')
  }

  for (const view of bundles) {
    if (
      view.binding.targetPhase !== 'railway_closed_beta' ||
      view.binding.environmentProfile !== 'railway-closed-beta-1'
    ) {
      return refuse(
        'wrong_target_phase',
        'closed-beta activation accepts only railway_closed_beta approvals',
      )
    }
    if (!isGoogleContentCapability(view.binding.capability)) {
      return refuse(
        'unknown_capability',
        `${view.binding.capability} is not a Google Content capability`,
      )
    }
  }

  const capabilities = bundles.map((view) => view.binding.capability)
  if (new Set(capabilities).size !== capabilities.length) {
    return refuse('duplicate_capability', 'exactly one bundle per capability is allowed')
  }

  // Checked BEFORE the fingerprint, though the fingerprint would also catch it.
  // `routeCatalogueVersion` is the field that actually goes stale — it is what
  // silently broke the beta — so a set that disagrees about it deserves to say
  // so, rather than reporting the generic "mixed deployments".
  const catalogues = new Set(bundles.map((view) => view.binding.routeCatalogueVersion))
  if (catalogues.size !== 1) {
    return refuse('mixed_route_catalogues', 'all bundles must pin one route catalogue')
  }

  if (new Set(bundles.map(commonFingerprint)).size !== 1) {
    return refuse('mixed_deployments', 'all bundles must bind one exact deployment')
  }

  if (new Set(bundles.flatMap((view) => view.approverIdentities)).size !== 1) {
    return refuse('mixed_owners', 'all bundles must name one accountable owner')
  }

  const bindings = Object.fromEntries(
    bundles.map((view) => [view.binding.capability, runtimeBinding(view)]),
  )

  return Object.freeze({
    ok: true as const,
    capabilities: Object.freeze([...capabilities].sort()),
    routeCatalogueVersion: [...catalogues][0] as string,
    // Every bundle in a valid set shares one window — the signer stamps one
    // `expiresAt` across the run, and the fingerprint above refuses a set that
    // does not agree. So this is the set's expiry, not a minimum over rivals.
    expiresAt: bundles[0]?.binding.expiresAt ?? '',
    runtimeBindingsJson: JSON.stringify(bindings),
  })
}
