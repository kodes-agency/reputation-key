import type { Clock } from '#/shared/domain/clock'
import {
  completeExecutionPermit,
  createAdmittedExecutionPermit,
  fenceExecutionPermit,
  startExecutionPermit,
  type AuthorizationCommitVectorMode,
  type AuthorizationExecutionPermit,
} from './authorization-execution-permit'
import {
  validateGoogleContentApprovalBundle,
  validateGoogleContentApprovalCandidate,
  type GoogleContentApprovalBundle,
  type GoogleContentApprovalCandidate,
  type GoogleContentApprovalSignatureVerifier,
  type GoogleContentApprovalValidationCode,
} from './google-content-approval'
import type {
  GoogleContentApprovalBinding,
  GoogleContentCapability,
} from './google-content-contract'
import type { RequiredPolicyRefreshResult } from './persisted-policy-store'

export type GoogleContentRuntimeBinding = Omit<
  GoogleContentApprovalBinding,
  'approvedAt' | 'expiresAt' | 'status'
>

export type GoogleContentControlState = Readonly<{
  policyVersion: number
  emergencyKillVersion: number
  killedCapabilities: ReadonlyArray<GoogleContentCapability>
}>

export type GoogleContentApprovalRecord = Readonly<{
  id: string
  candidate: GoogleContentApprovalCandidate
}>

export type GoogleContentAuthorizationVector = Readonly<
  Record<string, string | number | boolean | null>
>

export type GoogleContentPermitRecord = Readonly<{
  permit: AuthorizationExecutionPermit
  authorizationVector: GoogleContentAuthorizationVector
}>

export type GoogleContentProviderRequestBinding = Readonly<{
  requestBindingSha256: string
  credentialBinding: string
  projectFingerprint: string
  requestBodySha256: string | null
  requestBodyBytes: number
}>
export type GoogleContentAuthorizationScope = Readonly<{
  organizationId: string
  propertyId: string | null
  connectionId: string | null
  initiatorUserId: string | null
}>

export type GoogleContentAuthorityStore<Tx> = Readonly<{
  transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T>
  loadControl(tx: Tx): Promise<GoogleContentControlState>
  appendApproval(
    tx: Tx,
    candidate: GoogleContentApprovalCandidate,
  ): Promise<GoogleContentApprovalRecord>
  loadApprovalForRuntime(
    tx: Tx,
    runtime: GoogleContentRuntimeBinding,
  ): Promise<GoogleContentApprovalRecord | null>
  loadApprovalById(tx: Tx, id: string): Promise<GoogleContentApprovalRecord | null>
  nextPermitGeneration(
    tx: Tx,
    input: Readonly<{
      capability: GoogleContentCapability
      scope: GoogleContentAuthorizationScope
      operationKey: string
    }>,
  ): Promise<number>
  insertPermit(tx: Tx, record: GoogleContentPermitRecord): Promise<void>
  lockPermit(tx: Tx, id: string): Promise<GoogleContentPermitRecord | null>
  /**
   * Bounded oldest-first candidate scan for the start-deadline sweeper, scoped to
   * the leading `capability` column of
   * `authorization_execution_permits_active_idx`. Every candidate is re-locked
   * and re-decided by `fenceElapsedStartDeadlinePermit`, so this predicate is
   * selection only, never the fence authority.
   */
  listElapsedAdmittedPermitIds(
    tx: Tx,
    input: Readonly<{
      capabilities: readonly GoogleContentCapability[]
      before: Date
      limit: number
    }>,
  ): Promise<readonly string[]>
  updatePermit(tx: Tx, permit: AuthorizationExecutionPermit): Promise<void>
  denyCapability(
    tx: Tx,
    capability: GoogleContentCapability,
    input: Readonly<{ deniedAt: Date; operatorId: string; reason: string }>,
  ): Promise<number>
  allowCapability(
    tx: Tx,
    capability: GoogleContentCapability,
    input: Readonly<{ operatorId: string; reason: string; changedAt: Date }>,
  ): Promise<number>
  fenceActivePermits(tx: Tx, capability: GoogleContentCapability, at: Date): Promise<void>
  hasActiveCapabilityWork(tx: Tx, capability: GoogleContentCapability): Promise<boolean>
  hasActiveCleanupWork(tx: Tx, capability: GoogleContentCapability): Promise<boolean>
  markCapabilityDrained(
    tx: Tx,
    capability: GoogleContentCapability,
    at: Date,
    input: Readonly<{ workDrained: boolean; cleanupDrained: boolean }>,
  ): Promise<void>
}>

export type GoogleContentAuthorizationDecision =
  | Readonly<{
      allowed: true
      vector: GoogleContentAuthorizationVector
    }>
  | Readonly<{ allowed: false; code: string }>

export type GoogleContentAuthorizationCheck<Tx> = (
  tx: Tx,
  input: Readonly<{
    capability: GoogleContentCapability
    scope: GoogleContentAuthorizationScope
    operationKey: string
    vectorMode: AuthorizationCommitVectorMode
  }>,
) => Promise<GoogleContentAuthorizationDecision>

export type GoogleContentAdmissionInput = Readonly<{
  runtimeBinding: GoogleContentRuntimeBinding
  scope: GoogleContentAuthorizationScope
  expectedApprovalBindingId: string
  expectedAuthorizationVector: GoogleContentAuthorizationVector
  operationKey: string
  routeKey: string
  routeCatalogVersion: string
  quotaPolicyId: string
  providerRequestBinding: GoogleContentProviderRequestBinding
  startVectorMode: AuthorizationCommitVectorMode
  commitVectorMode: AuthorizationCommitVectorMode
}>

export type GoogleContentPreauthorizationInput = Readonly<{
  runtimeBinding: GoogleContentRuntimeBinding
  scope: GoogleContentAuthorizationScope
  operationKey: string
  vectorMode: AuthorizationCommitVectorMode
}>

export type GoogleContentPreauthorizationResult =
  | Readonly<{
      ok: true
      approvalBindingId: string
      policyVersion: number
      emergencyKillVersion: number
      authorizationVector: GoogleContentAuthorizationVector
    }>
  | Readonly<{ ok: false; code: GoogleContentAuthorityDenyCode }>

export type GoogleContentAuthorityDenyCode =
  | GoogleContentApprovalValidationCode
  | 'approval_unavailable'
  | 'runtime_binding_mismatch'
  | 'capability_killed'
  | 'policy_refresh_unavailable'
  | 'operator_not_registered'
  | 'reason_required'
  | 'authorization_denied'
  | 'authorization_changed'
  | 'operation_deadline_elapsed'
  | 'permit_unavailable'
  | 'permit_state_changed'
  | 'start_deadline_elapsed'
  | 'policy_version_changed'
  | 'emergency_kill_changed'
  | 'state_not_admitted'
  | 'approval_binding_changed'

export type GoogleContentPermitResult =
  | Readonly<{ ok: true; permit: AuthorizationExecutionPermit }>
  | Readonly<{ ok: false; code: GoogleContentAuthorityDenyCode }>

export type GoogleContentAuthorizationAuthority = Readonly<{
  installApproval(
    bundle: GoogleContentApprovalBundle,
  ): Promise<
    | Readonly<{ ok: true; approvalBindingId: string }>
    | Readonly<{ ok: false; code: GoogleContentApprovalValidationCode }>
  >
  preauthorize(
    input: GoogleContentPreauthorizationInput,
  ): Promise<GoogleContentPreauthorizationResult>
  admit(input: GoogleContentAdmissionInput): Promise<GoogleContentPermitResult>
  start(
    permitId: string,
    runtimeBinding: GoogleContentRuntimeBinding,
  ): Promise<GoogleContentPermitResult>
  complete(
    permitId: string,
    runtimeBinding: GoogleContentRuntimeBinding,
  ): Promise<GoogleContentPermitResult>
  fence(permitId: string): Promise<GoogleContentPermitResult>
  allowCapability(
    runtimeBinding: GoogleContentRuntimeBinding,
    operatorId: string,
    reason: string,
  ): Promise<
    | Readonly<{ ok: true; emergencyKillVersion: number }>
    | Readonly<{ ok: false; code: GoogleContentAuthorityDenyCode }>
  >
  denyCapability(
    capability: GoogleContentCapability,
    operatorId: string,
    reason: string,
  ): Promise<
    | Readonly<{ ok: true; emergencyKillVersion: number; drained: boolean }>
    | Readonly<{ ok: false; code: 'operator_not_registered' | 'reason_required' }>
  >
}>

export type GoogleContentApprovalInstaller = Readonly<{
  installApproval(
    bundle: GoogleContentApprovalBundle,
  ): Promise<
    | Readonly<{ ok: true; approvalBindingId: string }>
    | Readonly<{ ok: false; code: GoogleContentApprovalValidationCode }>
  >
}>

export function createGoogleContentApprovalInstaller<Tx>(
  deps: Readonly<{
    store: Pick<GoogleContentAuthorityStore<Tx>, 'transaction' | 'appendApproval'>
    clock: Clock
    verifyRoleApproval: GoogleContentApprovalSignatureVerifier
  }>,
): GoogleContentApprovalInstaller {
  return {
    installApproval: (bundle) =>
      deps.store.transaction(async (tx) => {
        const validation = validateGoogleContentApprovalBundle(
          bundle,
          deps.clock(),
          deps.verifyRoleApproval,
        )
        if (!validation.ok) return validation
        const record = await deps.store.appendApproval(tx, bundle.candidate)
        return { ok: true as const, approvalBindingId: record.id }
      }),
  }
}

function sameRuntimeBinding(
  actual: GoogleContentApprovalBinding,
  expected: GoogleContentRuntimeBinding,
): boolean {
  return (
    actual.capability === expected.capability &&
    actual.targetPhase === expected.targetPhase &&
    actual.environmentProfile === expected.environmentProfile &&
    actual.releaseSha === expected.releaseSha &&
    actual.evidenceManifestSha256 === expected.evidenceManifestSha256 &&
    actual.evidenceIndexSha256 === expected.evidenceIndexSha256 &&
    actual.deploymentAttestationSha256 === expected.deploymentAttestationSha256 &&
    actual.adr0050Sha256 === expected.adr0050Sha256 &&
    actual.googleContentPolicyVersion === expected.googleContentPolicyVersion &&
    actual.googleOAuthContractVersion === expected.googleOAuthContractVersion &&
    actual.googleProjectAttestationSha256 === expected.googleProjectAttestationSha256 &&
    actual.googleOAuthClientIdSha256 === expected.googleOAuthClientIdSha256 &&
    actual.googleRedirectUriSha256 === expected.googleRedirectUriSha256 &&
    actual.providerOriginProfileSha256 === expected.providerOriginProfileSha256 &&
    actual.runtimeIsolationProfileVersion === expected.runtimeIsolationProfileVersion &&
    actual.runtimeIsolationProfileSha256 === expected.runtimeIsolationProfileSha256 &&
    actual.railwayClosedBetaCohortSha256 === expected.railwayClosedBetaCohortSha256 &&
    actual.railwayClosedBetaResidualRiskSha256 ===
      expected.railwayClosedBetaResidualRiskSha256 &&
    actual.railwayClosedBetaCohort?.length === expected.railwayClosedBetaCohort?.length &&
    (actual.railwayClosedBetaCohort === null ||
      actual.railwayClosedBetaCohort.every(
        (organizationId, index) =>
          organizationId === expected.railwayClosedBetaCohort?.[index],
      )) &&
    actual.performanceCatalogVersion === expected.performanceCatalogVersion &&
    actual.routeCatalogueVersion === expected.routeCatalogueVersion &&
    actual.capabilityPolicyVersion === expected.capabilityPolicyVersion &&
    actual.executionPolicyVersion === expected.executionPolicyVersion &&
    actual.migrationHead === expected.migrationHead &&
    actual.imageDigests.web === expected.imageDigests.web &&
    actual.imageDigests.worker === expected.imageDigests.worker &&
    actual.imageDigests.googleExecutionAdmission ===
      expected.imageDigests.googleExecutionAdmission &&
    actual.imageDigests.googleEgressGateway ===
      expected.imageDigests.googleEgressGateway &&
    actual.imageDigests.providerEphemeralRedis ===
      expected.imageDigests.providerEphemeralRedis
  )
}

function sameAuthorizationVector(
  left: GoogleContentAuthorizationVector,
  right: GoogleContentAuthorizationVector,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && left[key] === right[key],
  )
}

const PROVIDER_REQUEST_BINDING_KEYS = new Set([
  'requestBindingSha256',
  'credentialBinding',
  'projectFingerprint',
  'requestBodySha256',
  'requestBodyBytes',
])
const SHA256 = /^[a-f0-9]{64}$/

function validProviderRequestBinding(
  value: GoogleContentProviderRequestBinding,
): boolean {
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

function authorizationDecisionMatches(
  decision: GoogleContentAuthorizationVector,
  persisted: GoogleContentAuthorizationVector,
): boolean {
  const core = Object.fromEntries(
    Object.entries(persisted).filter(([key]) => !PROVIDER_REQUEST_BINDING_KEYS.has(key)),
  )
  return sameAuthorizationVector(decision, core)
}

function validationCode(
  approval: GoogleContentApprovalRecord,
  runtimeBinding: GoogleContentRuntimeBinding,
  now: Date,
  verifyRoleApproval: GoogleContentApprovalSignatureVerifier,
): GoogleContentAuthorityDenyCode | null {
  const validation = validateGoogleContentApprovalCandidate(
    approval.candidate,
    now,
    verifyRoleApproval,
  )
  if (!validation.ok) return validation.code
  return sameRuntimeBinding(validation.binding, runtimeBinding)
    ? null
    : 'runtime_binding_mismatch'
}
function bindingAuthorizesOrganization(
  binding: GoogleContentApprovalBinding,
  organizationId: string,
): boolean {
  return (
    binding.targetPhase !== 'railway_closed_beta' ||
    binding.railwayClosedBetaCohort?.includes(organizationId) === true
  )
}

export function createGoogleContentAuthorizationAuthority<Tx>(
  deps: Readonly<{
    store: GoogleContentAuthorityStore<Tx>
    clock: Clock
    newPermitId: () => string
    verifyRoleApproval: GoogleContentApprovalSignatureVerifier
    refreshPolicy: () => Promise<RequiredPolicyRefreshResult>
    isRegisteredOperator: (operatorId: string) => boolean
    authorize: GoogleContentAuthorizationCheck<Tx>
  }>,
): GoogleContentAuthorizationAuthority {
  const approvalInstaller = createGoogleContentApprovalInstaller(deps)
  const fenceAndPersist = async (
    tx: Tx,
    permit: AuthorizationExecutionPermit,
    now: Date,
  ): Promise<AuthorizationExecutionPermit> => {
    const fenced = fenceExecutionPermit(permit, now) ?? permit
    if (fenced !== permit) await deps.store.updatePermit(tx, fenced)
    return fenced
  }

  const revalidatePermit = async (
    tx: Tx,
    record: GoogleContentPermitRecord,
    runtimeBinding: GoogleContentRuntimeBinding,
    now: Date,
    refreshedControl: Exclude<RequiredPolicyRefreshResult, { unavailable: true }>,
  ): Promise<GoogleContentAuthorityDenyCode | null> => {
    const control = await deps.store.loadControl(tx)
    if (control.policyVersion !== refreshedControl.version) {
      await fenceAndPersist(tx, record.permit, now)
      return 'policy_version_changed'
    }
    if (control.emergencyKillVersion !== refreshedControl.emergencyKillVersion) {
      await fenceAndPersist(tx, record.permit, now)
      return 'emergency_kill_changed'
    }
    if (control.killedCapabilities.includes(record.permit.capability)) {
      await fenceAndPersist(tx, record.permit, now)
      return 'capability_killed'
    }
    if (control.policyVersion !== record.permit.policyVersion) {
      await fenceAndPersist(tx, record.permit, now)
      return 'policy_version_changed'
    }
    if (control.emergencyKillVersion !== record.permit.emergencyKillVersion) {
      await fenceAndPersist(tx, record.permit, now)
      return 'emergency_kill_changed'
    }

    const approval = await deps.store.loadApprovalById(
      tx,
      record.permit.approvalBindingId,
    )
    if (!approval) {
      await fenceAndPersist(tx, record.permit, now)
      return 'approval_unavailable'
    }
    const approvalCode = validationCode(
      approval,
      runtimeBinding,
      now,
      deps.verifyRoleApproval,
    )
    if (approvalCode) {
      await fenceAndPersist(tx, record.permit, now)
      return approvalCode
    }
    if (
      !bindingAuthorizesOrganization(
        approval.candidate.binding,
        record.permit.organizationId,
      )
    ) {
      await fenceAndPersist(tx, record.permit, now)
      return 'authorization_denied'
    }

    const decision = await deps.authorize(tx, {
      capability: record.permit.capability,
      scope: {
        organizationId: record.permit.organizationId,
        propertyId: record.permit.propertyId,
        connectionId: record.permit.connectionId,
        initiatorUserId: record.permit.initiatorUserId,
      },
      operationKey: record.permit.operationKey,
      vectorMode: record.permit.commitVectorMode,
    })
    if (!decision.allowed) {
      await fenceAndPersist(tx, record.permit, now)
      return 'authorization_denied'
    }
    if (!authorizationDecisionMatches(decision.vector, record.authorizationVector)) {
      await fenceAndPersist(tx, record.permit, now)
      return 'authorization_changed'
    }
    return null
  }

  const refreshControl = async () => {
    const control = await deps.refreshPolicy()
    return 'unavailable' in control ? null : control
  }

  const authorizeRuntime = async (
    tx: Tx,
    input: GoogleContentPreauthorizationInput,
    refreshedControl: Exclude<RequiredPolicyRefreshResult, { unavailable: true }>,
    now: Date,
  ) => {
    const control = await deps.store.loadControl(tx)
    if (control.policyVersion !== refreshedControl.version) {
      return { ok: false as const, code: 'policy_version_changed' as const }
    }
    if (control.emergencyKillVersion !== refreshedControl.emergencyKillVersion) {
      return { ok: false as const, code: 'emergency_kill_changed' as const }
    }
    if (control.killedCapabilities.includes(input.runtimeBinding.capability)) {
      return { ok: false as const, code: 'capability_killed' as const }
    }

    const approval = await deps.store.loadApprovalForRuntime(tx, input.runtimeBinding)
    if (!approval) {
      return { ok: false as const, code: 'approval_unavailable' as const }
    }
    const approvalCode = validationCode(
      approval,
      input.runtimeBinding,
      now,
      deps.verifyRoleApproval,
    )
    if (approvalCode) return { ok: false as const, code: approvalCode }
    if (
      !bindingAuthorizesOrganization(
        approval.candidate.binding,
        input.scope.organizationId,
      )
    ) {
      return { ok: false as const, code: 'authorization_denied' as const }
    }

    const decision = await deps.authorize(tx, {
      capability: input.runtimeBinding.capability,
      scope: input.scope,
      operationKey: input.operationKey,
      vectorMode: input.vectorMode,
    })
    if (!decision.allowed) {
      return { ok: false as const, code: 'authorization_denied' as const }
    }
    if (
      Object.keys(decision.vector).some((key) => PROVIDER_REQUEST_BINDING_KEYS.has(key))
    ) {
      return { ok: false as const, code: 'authorization_denied' as const }
    }
    return { ok: true as const, control, approval, decision }
  }

  return {
    installApproval: approvalInstaller.installApproval,

    preauthorize: async (input) => {
      const refreshedControl = await refreshControl()
      if (!refreshedControl) {
        return { ok: false as const, code: 'policy_refresh_unavailable' as const }
      }
      return deps.store.transaction(async (tx) => {
        const authorized = await authorizeRuntime(
          tx,
          input,
          refreshedControl,
          deps.clock(),
        )
        if (!authorized.ok) return authorized
        return {
          ok: true as const,
          approvalBindingId: authorized.approval.id,
          policyVersion: authorized.control.policyVersion,
          emergencyKillVersion: authorized.control.emergencyKillVersion,
          authorizationVector: authorized.decision.vector,
        }
      })
    },

    admit: async (input) => {
      const refreshedControl = await refreshControl()
      if (!refreshedControl) {
        return { ok: false as const, code: 'policy_refresh_unavailable' as const }
      }
      return deps.store.transaction(async (tx) => {
        const admittedAt = deps.clock()
        const authorized = await authorizeRuntime(
          tx,
          {
            runtimeBinding: input.runtimeBinding,
            scope: input.scope,
            operationKey: input.operationKey,
            vectorMode: input.startVectorMode,
          },
          refreshedControl,
          admittedAt,
        )
        if (!authorized.ok) return authorized
        if (authorized.approval.id !== input.expectedApprovalBindingId) {
          return { ok: false as const, code: 'approval_binding_changed' as const }
        }
        if (
          !sameAuthorizationVector(
            authorized.decision.vector,
            input.expectedAuthorizationVector,
          )
        ) {
          return { ok: false as const, code: 'authorization_changed' as const }
        }
        if (!validProviderRequestBinding(input.providerRequestBinding)) {
          return { ok: false as const, code: 'authorization_denied' as const }
        }

        const permitGeneration = await deps.store.nextPermitGeneration(tx, {
          capability: input.runtimeBinding.capability,
          scope: input.scope,
          operationKey: input.operationKey,
        })
        const permit = createAdmittedExecutionPermit(
          {
            id: deps.newPermitId(),
            capability: input.runtimeBinding.capability,
            ...input.scope,
            operationKey: input.operationKey,
            routeKey: input.routeKey,
            routeCatalogVersion: input.routeCatalogVersion,
            quotaPolicyId: input.quotaPolicyId,
            policyVersion: authorized.control.policyVersion,
            emergencyKillVersion: authorized.control.emergencyKillVersion,
            approvalBindingId: authorized.approval.id,
            permitGeneration,
            startVectorMode: input.startVectorMode,
            commitVectorMode: input.commitVectorMode,
          },
          admittedAt,
        )
        await deps.store.insertPermit(tx, {
          permit,
          authorizationVector: {
            ...authorized.decision.vector,
            ...input.providerRequestBinding,
          },
        })
        return { ok: true as const, permit }
      })
    },

    start: async (permitId, runtimeBinding) => {
      const refreshedControl = await refreshControl()
      if (!refreshedControl) {
        return { ok: false as const, code: 'policy_refresh_unavailable' as const }
      }
      return deps.store.transaction(async (tx) => {
        const record = await deps.store.lockPermit(tx, permitId)
        if (!record) return { ok: false as const, code: 'permit_unavailable' as const }
        const now = deps.clock()
        const revalidationCode = await revalidatePermit(
          tx,
          record,
          runtimeBinding,
          now,
          refreshedControl,
        )
        if (revalidationCode) return { ok: false as const, code: revalidationCode }

        const started = startExecutionPermit(record.permit, {
          now,
          policyVersion: record.permit.policyVersion,
          emergencyKillVersion: record.permit.emergencyKillVersion,
          approvalBindingId: record.permit.approvalBindingId,
        })
        await deps.store.updatePermit(tx, started.permit)
        return started.kind === 'started'
          ? { ok: true as const, permit: started.permit }
          : { ok: false as const, code: started.reason }
      })
    },

    complete: async (permitId, runtimeBinding) => {
      const refreshedControl = await refreshControl()
      if (!refreshedControl) {
        return { ok: false as const, code: 'policy_refresh_unavailable' as const }
      }
      return deps.store.transaction(async (tx) => {
        const record = await deps.store.lockPermit(tx, permitId)
        if (!record) return { ok: false as const, code: 'permit_unavailable' as const }
        const now = deps.clock()
        const revalidationCode = await revalidatePermit(
          tx,
          record,
          runtimeBinding,
          now,
          refreshedControl,
        )
        if (revalidationCode) return { ok: false as const, code: revalidationCode }
        const completed = completeExecutionPermit(record.permit, now)
        if (!completed) {
          const deadlineElapsed =
            record.permit.state === 'started' &&
            record.permit.operationDeadlineAt !== null &&
            now.getTime() >= record.permit.operationDeadlineAt.getTime()
          await fenceAndPersist(tx, record.permit, now)
          return {
            ok: false as const,
            code: deadlineElapsed
              ? ('operation_deadline_elapsed' as const)
              : ('permit_state_changed' as const),
          }
        }
        await deps.store.updatePermit(tx, completed)
        return { ok: true as const, permit: completed }
      })
    },

    fence: (permitId) =>
      deps.store.transaction(async (tx) => {
        const record = await deps.store.lockPermit(tx, permitId)
        if (!record) return { ok: false as const, code: 'permit_unavailable' as const }
        const fenced = await fenceAndPersist(tx, record.permit, deps.clock())
        return fenced === record.permit
          ? { ok: false as const, code: 'permit_state_changed' as const }
          : { ok: true as const, permit: fenced }
      }),
    allowCapability: (runtimeBinding, operatorId, reason) => {
      if (!deps.isRegisteredOperator(operatorId)) {
        return Promise.resolve({
          ok: false as const,
          code: 'operator_not_registered' as const,
        })
      }
      if (reason.trim().length < 3) {
        return Promise.resolve({ ok: false as const, code: 'reason_required' as const })
      }
      return deps.store.transaction(async (tx) => {
        const changedAt = deps.clock()
        const approval = await deps.store.loadApprovalForRuntime(tx, runtimeBinding)
        if (!approval) {
          return { ok: false as const, code: 'approval_unavailable' as const }
        }
        const approvalCode = validationCode(
          approval,
          runtimeBinding,
          changedAt,
          deps.verifyRoleApproval,
        )
        if (approvalCode) return { ok: false as const, code: approvalCode }
        const emergencyKillVersion = await deps.store.allowCapability(
          tx,
          runtimeBinding.capability,
          { operatorId, reason, changedAt },
        )
        return { ok: true as const, emergencyKillVersion }
      })
    },

    denyCapability: (capability, operatorId, reason) => {
      if (!deps.isRegisteredOperator(operatorId)) {
        return Promise.resolve({
          ok: false as const,
          code: 'operator_not_registered' as const,
        })
      }
      if (reason.trim().length < 3) {
        return Promise.resolve({ ok: false as const, code: 'reason_required' as const })
      }
      return deps.store.transaction(async (tx) => {
        const deniedAt = deps.clock()
        const emergencyKillVersion = await deps.store.denyCapability(tx, capability, {
          deniedAt,
          operatorId,
          reason,
        })
        await deps.store.fenceActivePermits(tx, capability, deniedAt)
        const [workActive, cleanupActive] = await Promise.all([
          deps.store.hasActiveCapabilityWork(tx, capability),
          deps.store.hasActiveCleanupWork(tx, capability),
        ])
        await deps.store.markCapabilityDrained(tx, capability, deniedAt, {
          workDrained: !workActive,
          cleanupDrained: !cleanupActive,
        })
        return {
          ok: true as const,
          emergencyKillVersion,
          drained: !workActive && !cleanupActive,
        }
      })
    },
  }
}
