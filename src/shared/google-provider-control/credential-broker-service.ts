import {
  validateGoogleCredentialBrokerGrant,
  type GoogleCredentialBrokerDenyCode,
  type GoogleCredentialBrokerExpectation,
  type GoogleCredentialBrokerGrant,
} from './credential-broker-contract'
import {
  credentialBrokerReplayIssueFromGrant,
  type DurableGoogleCredentialBrokerReplayStore,
} from './credential-broker-durable-state'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export type GoogleCredentialBrokerProtocolService = Readonly<{
  registerIssuedGrant(
    input: Readonly<{
      grant: GoogleCredentialBrokerGrant
      expected: GoogleCredentialBrokerExpectation
    }>,
  ): Promise<
    | Readonly<{ ok: true; status: 'issued' | 'duplicate' }>
    | Readonly<{ ok: false; code: GoogleCredentialBrokerDenyCode }>
  >
}>

/**
 * Transport-independent protocol boundary. It validates and registers an
 * opaque credential grant without exposing provider material.
 */
export function createGoogleCredentialBrokerProtocolService(
  deps: Readonly<{
    store: DurableGoogleCredentialBrokerReplayStore
    replayKeys: VersionedHmacKeyring
  }>,
): GoogleCredentialBrokerProtocolService {
  return Object.freeze({
    registerIssuedGrant: async ({ grant, expected }) => {
      const validated = validateGoogleCredentialBrokerGrant(grant, expected)
      if (!validated.ok) return validated
      const issue = credentialBrokerReplayIssueFromGrant(
        validated.value,
        deps.replayKeys,
        expected.nowMs,
      )
      return { ok: true, status: await deps.store.issue(issue) }
    },
  })
}
