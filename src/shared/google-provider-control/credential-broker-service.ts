import {
  validateGoogleCredentialBrokerGrant,
  type GoogleCredentialBrokerDenyCode,
  type GoogleCredentialBrokerGrant,
} from './credential-broker-contract'
import {
  credentialBrokerReplayIssueFromGrant,
  type DurableGoogleCredentialBrokerReplayStore,
} from './credential-broker-durable-state'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export type GoogleCredentialBrokerGrantExpectation = Parameters<
  typeof validateGoogleCredentialBrokerGrant
>[1]

export type GoogleCredentialBrokerProtocolService = Readonly<{
  registerIssuedGrant(
    input: Readonly<{
      grant: GoogleCredentialBrokerGrant
      expected: GoogleCredentialBrokerGrantExpectation
    }>,
  ): Promise<
    | Readonly<{ ok: true; status: 'issued' | 'duplicate' }>
    | Readonly<{ ok: false; code: GoogleCredentialBrokerDenyCode }>
  >
  admitCrossCellExecution(
    input: Readonly<{
      grant: GoogleCredentialBrokerGrant
      expected: GoogleCredentialBrokerGrantExpectation
    }>,
  ): Promise<Readonly<{ ok: false; code: 'live_execution_dark' }>>
}>

/**
 * Transport-independent Phase-B boundary. It can validate and register the
 * protocol, but deliberately exposes no method that returns a credential or
 * sealed reference to a target cell. Live home-cell execution remains dark.
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
    admitCrossCellExecution: async ({ grant, expected }) => {
      // Validation still runs so drills can prove exact tenant/route/gateway/
      // generation bindings without creating a target-cell token seam.
      validateGoogleCredentialBrokerGrant(grant, expected)
      return { ok: false, code: 'live_execution_dark' }
    },
  })
}
