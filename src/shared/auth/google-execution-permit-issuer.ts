import type { Clock } from '#/shared/domain/clock'
import type { GoogleContentCapability } from '#/shared/domain/google-content-capability'
import {
  hasGoogleProviderRequestBindingKeys,
  sameGoogleContentAuthorizationVector,
  type GoogleContentAuthorizationCheck,
  type GoogleContentAuthorizationScope,
  type GoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import {
  createAdmittedExecutionPermit,
  type AuthorizationExecutionPermit,
} from './authorization-execution-permit'

export type GoogleExecutionPermitRecord = Readonly<{
  permit: AuthorizationExecutionPermit
  authorizationVector: GoogleContentAuthorizationVector
}>

export type GoogleExecutionPermitIssuerStore<Tx> = Readonly<{
  transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T>
  loadControl(
    tx: Tx,
  ): Promise<Readonly<{ killedCapabilities: ReadonlyArray<GoogleContentCapability> }>>
  insertPermit(tx: Tx, record: GoogleExecutionPermitRecord): Promise<void>
}>

export type GoogleProviderRequestBinding = Readonly<{
  requestBindingSha256: string
  credentialBinding: string
  projectFingerprint: string
  requestBodySha256: string | null
  requestBodyBytes: number
}>

export type GoogleExecutionPermitAdmissionInput = Readonly<{
  capability: GoogleContentCapability
  scope: GoogleContentAuthorizationScope
  expectedAuthorizationVector: GoogleContentAuthorizationVector
  operationKey: string
  routeKey: string
  routeCatalogVersion: string
  quotaPolicyId: string
  providerRequestBinding: GoogleProviderRequestBinding
}>

export type GoogleExecutionPermitAdmissionCode =
  'capability_killed' | 'authorization_denied' | 'authorization_changed'

export type GoogleExecutionPermitAdmissionResult =
  | Readonly<{ ok: true; permit: AuthorizationExecutionPermit }>
  | Readonly<{ ok: false; code: GoogleExecutionPermitAdmissionCode }>

const SHA256 = /^[a-f0-9]{64}$/u

function validProviderRequestBinding(value: GoogleProviderRequestBinding): boolean {
  return (
    SHA256.test(value.requestBindingSha256) &&
    (value.credentialBinding === 'none' || SHA256.test(value.credentialBinding)) &&
    SHA256.test(value.projectFingerprint) &&
    (value.requestBodySha256 === null || SHA256.test(value.requestBodySha256)) &&
    Number.isSafeInteger(value.requestBodyBytes) &&
    value.requestBodyBytes >= 0 &&
    (value.requestBodyBytes === 0) === (value.requestBodySha256 === null)
  )
}

export function createGoogleExecutionPermitIssuer<Tx>(
  deps: Readonly<{
    store: GoogleExecutionPermitIssuerStore<Tx>
    clock: Clock
    newPermitId: () => string
    authorize: GoogleContentAuthorizationCheck<Tx>
  }>,
): (
  input: GoogleExecutionPermitAdmissionInput,
) => Promise<GoogleExecutionPermitAdmissionResult> {
  return (input) =>
    deps.store.transaction(async (tx) => {
      const admittedAt = deps.clock()
      const control = await deps.store.loadControl(tx)
      if (control.killedCapabilities.includes(input.capability)) {
        return { ok: false, code: 'capability_killed' }
      }

      const decision = await deps.authorize(tx, {
        capability: input.capability,
        scope: input.scope,
        operationKey: input.operationKey,
      })
      if (!decision.allowed || hasGoogleProviderRequestBindingKeys(decision.vector)) {
        return { ok: false, code: 'authorization_denied' }
      }
      if (
        !sameGoogleContentAuthorizationVector(
          decision.vector,
          input.expectedAuthorizationVector,
        )
      ) {
        return { ok: false, code: 'authorization_changed' }
      }
      if (!validProviderRequestBinding(input.providerRequestBinding)) {
        return { ok: false, code: 'authorization_denied' }
      }

      const permit = createAdmittedExecutionPermit(
        {
          id: deps.newPermitId(),
          capability: input.capability,
          ...input.scope,
          operationKey: input.operationKey,
          routeKey: input.routeKey,
          routeCatalogVersion: input.routeCatalogVersion,
          quotaPolicyId: input.quotaPolicyId,
        },
        admittedAt,
      )
      await deps.store.insertPermit(tx, {
        permit,
        authorizationVector: {
          ...decision.vector,
          ...input.providerRequestBinding,
        },
      })
      return { ok: true, permit }
    })
}
