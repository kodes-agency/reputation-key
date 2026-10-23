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
import {
  createPermitIssuanceTimer,
  type PermitIssuanceLogger,
  type PermitIssuanceTimer,
} from './google-execution-permit-issuance-timing'

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

type GoogleExecutionPermitIssuerDeps<Tx> = Readonly<{
  store: GoogleExecutionPermitIssuerStore<Tx>
  clock: Clock
  newPermitId: () => string
  authorize: GoogleContentAuthorizationCheck<Tx>
  /**
   * Monotonic milliseconds. With `logger`, a slow issuance is logged by stage
   * (#946: a token refresh lost 12 s after its permit was admitted, and
   * `admitted_at` is the start of this transaction, so the loss could have
   * been here). Without either, nothing is timed.
   */
  nowMs?: () => number
  logger?: PermitIssuanceLogger
}>

async function issueWithinTransaction<Tx>(
  deps: GoogleExecutionPermitIssuerDeps<Tx>,
  input: GoogleExecutionPermitAdmissionInput,
  tx: Tx,
  timer: PermitIssuanceTimer,
): Promise<GoogleExecutionPermitAdmissionResult> {
  const admittedAt = deps.clock()
  const control = await timer.stage('loadControlMs', () => deps.store.loadControl(tx))
  if (control.killedCapabilities.includes(input.capability)) {
    return { ok: false, code: 'capability_killed' }
  }

  const decision = await timer.stage('authorizeMs', () =>
    deps.authorize(tx, {
      capability: input.capability,
      scope: input.scope,
      operationKey: input.operationKey,
    }),
  )
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
  await timer.stage('insertPermitMs', () =>
    deps.store.insertPermit(tx, {
      permit,
      authorizationVector: {
        ...decision.vector,
        ...input.providerRequestBinding,
      },
    }),
  )
  return { ok: true, permit }
}

export function createGoogleExecutionPermitIssuer<Tx>(
  deps: GoogleExecutionPermitIssuerDeps<Tx>,
): (
  input: GoogleExecutionPermitAdmissionInput,
) => Promise<GoogleExecutionPermitAdmissionResult> {
  return async (input) => {
    const timer = createPermitIssuanceTimer({
      nowMs: deps.nowMs,
      logger: deps.logger,
      capability: input.capability,
      routeKey: input.routeKey,
    })
    let result: GoogleExecutionPermitAdmissionResult
    try {
      result = await deps.store.transaction(async (tx) => {
        timer.begun()
        const issued = await issueWithinTransaction(deps, input, tx, timer)
        timer.callbackReturned()
        return issued
      })
    } catch (error) {
      timer.finish('error', error)
      throw error
    }
    timer.finish(result.ok ? 'admitted' : result.code)
    return result
  }
}
