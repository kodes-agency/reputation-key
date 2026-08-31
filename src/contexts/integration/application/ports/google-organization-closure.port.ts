// LIF-01-T12 — the provider seam Organization closing revokes through.
//
// Closing an Organization is the moment Integration stops being a provider
// boundary: the Pub/Sub subscription must stop delivering and the OAuth grant
// must be revoked at Google. Both are external effects, so both are expressed
// here as a port rather than inlined into the lifecycle adapter: the eventual
// live drill then replays exactly the behaviour the recorded fixtures pinned.
//
// The contract that makes closure safe is CONVERGENCE, not success. Neither
// method may throw for a provider failure — a partial failure must return an
// honest outcome so the local fence still lands in the same transaction. A
// thrown provider error would roll the fence back and leave the Organization
// both un-revoked and un-fenced, which is strictly worse than an ambiguous
// revoke recorded beside a completed local fence.

/**
 * Provider outcomes, ordered from "definitely stopped" to "we cannot prove it".
 *
 * `already_revoked` is the second-call answer: Google answers a revoke for a
 * grant it no longer holds with a deterministic rejection, and that is a
 * converged success, never an error.
 */
export type GoogleClosureRevocationOutcome =
  'confirmed_revoked' | 'already_revoked' | 'confirmed_not_sent' | 'cleanup_ambiguous'

export type GoogleClosureSubscriptionOutcome =
  'stopped' | 'already_stopped' | 'not_sent' | 'ambiguous'

export type GoogleClosureConnectionTarget = Readonly<{
  organizationId: string
  connectionId: string
  /**
   * The stored, application-encrypted refresh token. It stays encrypted across
   * this boundary: only the provider adapter may decrypt, and only to send.
   */
  encryptedRefreshToken: string
  occurredAt: Date
}>

/**
 * Both methods MUST be idempotent for the same connection: a second call after
 * a partial failure converges on `already_revoked` / `already_stopped` instead
 * of throwing or re-sending a credential that is already gone.
 */
export type GoogleOrganizationClosureProviderPort = Readonly<{
  stopNotificationSubscriptions(
    target: GoogleClosureConnectionTarget,
  ): Promise<GoogleClosureSubscriptionOutcome>
  revokeCredentials(
    target: GoogleClosureConnectionTarget,
  ): Promise<GoogleClosureRevocationOutcome>
}>
