import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRoleDocument,
} from './google-content-contract'
import type { AuthorizationExecutionPermit } from './authorization-execution-permit'
import {
  createGoogleContentAuthorizationAuthority,
  type GoogleContentApprovalRecord,
  type GoogleContentControlState,
  type GoogleContentAuthorityStore,
  type GoogleContentRuntimeBinding,
} from './google-content-authority'
import {
  canonicalGoogleContentSha256,
  type GoogleContentApprovalCandidate,
} from './google-content-approval'

const now = new Date('2026-08-10T10:00:00.000Z')

const bindingBase = (): Omit<GoogleContentApprovalBinding, 'evidenceIndexSha256'> => ({
  capability: 'property.import_gbp_v2',
  targetPhase: 'local_sandbox',
  environmentProfile: 'sandbox',
  releaseSha: 'release-sha',
  evidenceManifestSha256: canonicalGoogleContentSha256('manifest'),
  deploymentAttestationSha256: canonicalGoogleContentSha256('deployment'),
  adr0050Sha256: canonicalGoogleContentSha256('adr-0050'),
  googleContentPolicyVersion: 'google-content-live-1',
  googleOAuthContractVersion: 'google-oauth-oidc-1',
  googleProjectAttestationSha256: canonicalGoogleContentSha256('project-attestation'),
  googleOAuthClientIdSha256: canonicalGoogleContentSha256('oauth-client-id'),
  googleRedirectUriSha256: canonicalGoogleContentSha256('redirect-uri'),
  providerOriginProfileSha256: canonicalGoogleContentSha256('provider-origin-profile'),
  runtimeIsolationProfileVersion: 'google-content-egress-1',
  runtimeIsolationProfileSha256: canonicalGoogleContentSha256(
    'runtime-isolation-profile',
  ),
  railwayClosedBetaCohort: null,
  railwayClosedBetaCohortSha256: null,
  railwayClosedBetaResidualRiskSha256: null,
  performanceCatalogVersion: '2026-08-05',
  capabilityPolicyVersion: 'beta-local-2',
  executionPolicyVersion: 'beta-local-2',
  migrationHead: '0029_google-content-control',
  imageDigests: {
    web: `sha256:${canonicalGoogleContentSha256('web-image')}`,
    worker: `sha256:${canonicalGoogleContentSha256('worker-image')}`,
    googleExecutionAdmission: `sha256:${canonicalGoogleContentSha256('admission-image')}`,
    googleEgressGateway: `sha256:${canonicalGoogleContentSha256('gateway-image')}`,
    providerEphemeralRedis: `sha256:${canonicalGoogleContentSha256('redis-image')}`,
  },
  approvedAt: '2026-08-10T10:00:00.000Z',
  expiresAt: '2026-08-12T10:00:00.000Z',
  status: 'approved',
})

const runtimeBinding = (): GoogleContentRuntimeBinding => {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = binding()
  return runtime
}

const roleDocument = (
  role: (typeof GOOGLE_CONTENT_APPROVAL_ROLES)[number],
): GoogleContentApprovalRoleDocument => ({
  role,
  capability: 'property.import_gbp_v2',
  manifestSha256: bindingBase().evidenceManifestSha256,
  releaseSha: 'release-sha',
  targetPhase: 'local_sandbox',
  environmentProfile: 'sandbox',
  transientPerformanceReportingDecision: 'approved',
  confirmedImportProfileTreatmentDecision: 'approved',
  unmanagedUserAgentMemoryResidualDecision: 'approved',
  railwayClosedBetaResidualDecision: null,
  railwayClosedBetaCohortSha256: null,
  railwayClosedBetaResidualRiskSha256: null,
  approverIdentity: `${role}-approver`,
  approvedAt: '2026-08-10T10:00:00.000Z',
  expiresAt: '2026-08-12T10:00:00.000Z',
  signature: `${role}-signature`,
})

const candidate = (): GoogleContentApprovalCandidate => {
  const roleDocuments = GOOGLE_CONTENT_APPROVAL_ROLES.map((role) => {
    const document = roleDocument(role)
    return { sha256: canonicalGoogleContentSha256(document), document }
  })
  const indexDocument = {
    manifestSha256: bindingBase().evidenceManifestSha256,
    artifactSha256: { deployment: bindingBase().deploymentAttestationSha256 },
    roleDocumentSha256: {
      'engineering/runtime': roleDocuments[0]!.sha256,
      'product/property': roleDocuments[1]!.sha256,
      'security/privacy': roleDocuments[2]!.sha256,
      'google-project/integration': roleDocuments[3]!.sha256,
      'operations/on-call': roleDocuments[4]!.sha256,
    },
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    binding: { ...bindingBase(), evidenceIndexSha256: index.sha256 },
    index,
    roleDocuments,
  }
}

const approvalBundle = () => ({ manifest: 'manifest', candidate: candidate() })

const binding = (): GoogleContentApprovalBinding => candidate().binding
const railwayCandidate = (): GoogleContentApprovalCandidate => {
  const cohort = ['org-1']
  const cohortSha256 = canonicalGoogleContentSha256(cohort)
  const residualRiskSha256 = canonicalGoogleContentSha256('railway-residual-risk')
  const approverIdentity = 'Railway Owner <owner@example.test>'
  const railwayRoleDocuments = GOOGLE_CONTENT_APPROVAL_ROLES.map((role) => {
    const document: GoogleContentApprovalRoleDocument = {
      ...roleDocument(role),
      targetPhase: 'railway_closed_beta',
      environmentProfile: 'railway-closed-beta-1',
      railwayClosedBetaResidualDecision: 'approved',
      railwayClosedBetaCohortSha256: cohortSha256,
      railwayClosedBetaResidualRiskSha256: residualRiskSha256,
      approverIdentity,
      expiresAt: '2026-09-09T10:00:00.000Z',
    }
    return { sha256: canonicalGoogleContentSha256(document), document }
  })
  const indexDocument = {
    manifestSha256: bindingBase().evidenceManifestSha256,
    artifactSha256: { deployment: bindingBase().deploymentAttestationSha256 },
    roleDocumentSha256: Object.fromEntries(
      railwayRoleDocuments.map((entry) => [entry.document.role, entry.sha256]),
    ) as GoogleContentApprovalCandidate['index']['roleDocumentSha256'],
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    binding: {
      ...bindingBase(),
      targetPhase: 'railway_closed_beta',
      environmentProfile: 'railway-closed-beta-1',
      runtimeIsolationProfileVersion: null,
      runtimeIsolationProfileSha256: null,
      railwayClosedBetaCohort: cohort,
      railwayClosedBetaCohortSha256: cohortSha256,
      railwayClosedBetaResidualRiskSha256: residualRiskSha256,
      evidenceIndexSha256: index.sha256,
      expiresAt: '2026-09-09T10:00:00.000Z',
    },
    index,
    roleDocuments: railwayRoleDocuments,
  }
}

const runtimeBindingFromCandidate = (
  input: GoogleContentApprovalCandidate,
): GoogleContentRuntimeBinding => {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = input.binding
  return runtime
}

type Tx = Readonly<Record<string, never>>

function createStore() {
  let control: GoogleContentControlState = {
    policyVersion: 12,
    emergencyKillVersion: 4,
    killedCapabilities: [],
  }
  const approvals = new Map<string, GoogleContentApprovalRecord>()
  const permits = new Map<
    string,
    Readonly<{
      permit: AuthorizationExecutionPermit
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>
  >()
  let drained = false

  const store: GoogleContentAuthorityStore<Tx> = {
    transaction: (run) => run({}),
    loadControl: async () => control,
    appendApproval: async (_tx, input) => {
      const record = { id: `approval-${approvals.size + 1}`, candidate: input }
      approvals.set(record.id, record)
      return record
    },
    loadApprovalForRuntime: async (_tx, runtime) =>
      [...approvals.values()].find(
        (record) => record.candidate.binding.capability === runtime.capability,
      ) ?? null,
    loadApprovalById: async (_tx, id) => approvals.get(id) ?? null,
    nextPermitGeneration: async () => permits.size + 1,
    insertPermit: async (_tx, record) => {
      permits.set(record.permit.id, record)
    },
    lockPermit: async (_tx, id) => permits.get(id) ?? null,
    updatePermit: async (_tx, permit) => {
      const existing = permits.get(permit.id)
      if (!existing) throw new Error('missing permit')
      permits.set(permit.id, { ...existing, permit })
    },
    denyCapability: async (_tx, capability) => {
      control = {
        ...control,
        emergencyKillVersion: control.emergencyKillVersion + 1,
        killedCapabilities: [...new Set([...control.killedCapabilities, capability])],
      }
      return control.emergencyKillVersion
    },
    allowCapability: async (_tx, capability) => {
      control = {
        ...control,
        emergencyKillVersion: control.emergencyKillVersion + 1,
        killedCapabilities: control.killedCapabilities.filter(
          (killed) => killed !== capability,
        ),
      }
      return control.emergencyKillVersion
    },
    fenceActivePermits: async (_tx, capability, at) => {
      for (const record of permits.values()) {
        if (
          record.permit.capability === capability &&
          (record.permit.state === 'admitted' || record.permit.state === 'started')
        ) {
          permits.set(record.permit.id, {
            ...record,
            permit: { ...record.permit, state: 'fenced', fencedAt: at },
          })
        }
      }
    },
    hasActiveCapabilityWork: async () => false,
    hasActiveCleanupWork: async () => false,
    markCapabilityDrained: async () => {
      drained = true
    },
  }

  return {
    store,
    permits,
    approvals,
    setControl(next: typeof control) {
      control = next
    },
    control: () => control,
    isDrained: () => drained,
  }
}

const freshPolicy = (memory: ReturnType<typeof createStore>) => async () => ({
  version: memory.control().policyVersion,
  emergencyKillVersion: memory.control().emergencyKillVersion,
})

const admissionInput = (
  expectedAuthorizationVector: Readonly<Record<string, string | number>> = {
    grantGeneration: 3,
  },
) => ({
  runtimeBinding: runtimeBinding(),
  scope: {
    organizationId: 'org-1',
    propertyId: null,
    connectionId: 'connection-1',
    initiatorUserId: 'user-1',
  },
  expectedApprovalBindingId: 'approval-1',
  expectedAuthorizationVector,
  operationKey: 'import.start',
  routeKey: 'google.business-information.locations.list',
  routeCatalogVersion: 'google-provider-routes-1',
  quotaPolicyId: 'gbp-business-information-interactive-1',
  providerRequestBinding: {
    requestBindingSha256: 'a'.repeat(64),
    credentialBinding: 'b'.repeat(64),
    projectFingerprint: 'c'.repeat(64),
    requestBodySha256: null,
    requestBodyBytes: 0,
  },
  startVectorMode: 'full' as const,
  commitVectorMode: 'full' as const,
})

describe('Google Content authorization authority', () => {
  it('persists only an exact valid five-role approval chain', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: (document) =>
        document.signature === `${document.role}-signature`,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })

    await expect(authority.installApproval(approvalBundle())).resolves.toEqual({
      ok: true,
      approvalBindingId: 'approval-1',
    })
    await expect(
      authority.installApproval({
        ...approvalBundle(),
        candidate: {
          ...candidate(),
          roleDocuments: candidate().roleDocuments.map((entry, index) =>
            index === 0
              ? { ...entry, document: { ...entry.document, signature: 'invalid' } }
              : entry,
          ),
        },
      }),
    ).resolves.toEqual({ ok: false, code: 'role_digest_mismatch' })
    expect(memory.approvals).toHaveLength(1)
  })

  it('preauthorizes against the current approval, control, and authorization vector', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({
        allowed: true,
        vector: { grantGeneration: 3, connectionGeneration: 8 },
      }),
    })
    await authority.installApproval(approvalBundle())

    await expect(
      authority.preauthorize({
        runtimeBinding: runtimeBinding(),
        scope: admissionInput().scope,
        operationKey: 'import.discovery',
        vectorMode: 'full',
      }),
    ).resolves.toEqual({
      ok: true,
      approvalBindingId: 'approval-1',
      policyVersion: 12,
      emergencyKillVersion: 4,
      authorizationVector: { grantGeneration: 3, connectionGeneration: 8 },
    })
  })

  it('rejects admission when the preauthorized binding or vector changed', async () => {
    const memory = createStore()
    let generation = 3
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: generation } }),
    })
    await authority.installApproval(approvalBundle())

    await expect(
      authority.admit({
        ...admissionInput(),
        expectedApprovalBindingId: 'approval-stale',
      }),
    ).resolves.toEqual({ ok: false, code: 'approval_binding_changed' })
    generation = 4
    await expect(authority.admit(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    expect(memory.permits).toHaveLength(0)
  })

  it('fails closed while the capability kill is active', async () => {
    const memory = createStore()
    memory.setControl({
      policyVersion: 12,
      emergencyKillVersion: 5,
      killedCapabilities: ['property.import_gbp_v2'],
    })
    const authorize = vi.fn(async () => ({
      allowed: true as const,
      vector: { grantGeneration: 3 },
    }))
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize,
    })
    await authority.installApproval(approvalBundle())

    await expect(authority.admit(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'capability_killed',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(memory.permits).toHaveLength(0)
  })

  it('fails closed when the authoritative policy refresh is unavailable', async () => {
    const memory = createStore()
    const authorize = vi.fn(async () => ({
      allowed: true as const,
      vector: { grantGeneration: 3 },
    }))
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: async () => ({ unavailable: true }),
      isRegisteredOperator: () => true,
      authorize,
    })
    await authority.installApproval(approvalBundle())

    await expect(authority.admit(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'policy_refresh_unavailable',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(memory.permits).toHaveLength(0)
  })

  it('admits Railway closed-beta work only for its signed organization cohort', async () => {
    const memory = createStore()
    const authorize = vi.fn(async () => ({
      allowed: true as const,
      vector: { grantGeneration: 3 },
    }))
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize,
    })
    const railway = railwayCandidate()
    await authority.installApproval({ manifest: 'manifest', candidate: railway })

    await expect(
      authority.admit({
        ...admissionInput(),
        runtimeBinding: runtimeBindingFromCandidate(railway),
        scope: { ...admissionInput().scope, organizationId: 'org-outside-cohort' },
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(authorize).not.toHaveBeenCalled()
    expect(memory.permits).toHaveLength(0)

    await expect(
      authority.admit({
        ...admissionInput(),
        runtimeBinding: runtimeBindingFromCandidate(railway),
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('allows a killed capability only for a named operator with an exact approval', async () => {
    const memory = createStore()
    memory.setControl({
      policyVersion: 12,
      emergencyKillVersion: 5,
      killedCapabilities: ['property.import_gbp_v2'],
    })
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: (operatorId) => operatorId === 'operator-1',
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })

    await expect(
      authority.allowCapability(runtimeBinding(), 'unknown', 'approved rollout'),
    ).resolves.toEqual({ ok: false, code: 'operator_not_registered' })
    await expect(
      authority.allowCapability(runtimeBinding(), 'operator-1', 'approved rollout'),
    ).resolves.toEqual({ ok: false, code: 'approval_unavailable' })

    await authority.installApproval(approvalBundle())
    await expect(
      authority.allowCapability(runtimeBinding(), 'operator-1', 'approved rollout'),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 6 })
    await expect(authority.admit(admissionInput())).resolves.toMatchObject({
      ok: true,
      permit: { emergencyKillVersion: 6 },
    })
  })

  it('admits and starts only against the same approval, policy, and authorization vector', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({
        allowed: true,
        vector: { grantGeneration: 3, connectionGeneration: 8 },
      }),
    })
    await authority.installApproval(approvalBundle())

    const admitted = await authority.admit(
      admissionInput({ grantGeneration: 3, connectionGeneration: 8 }),
    )
    expect(admitted).toMatchObject({ ok: true, permit: { state: 'admitted' } })
    expect(memory.permits.get('permit-1')?.authorizationVector).toEqual({
      grantGeneration: 3,
      connectionGeneration: 8,
      requestBindingSha256: 'a'.repeat(64),
      credentialBinding: 'b'.repeat(64),
      projectFingerprint: 'c'.repeat(64),
      requestBodySha256: null,
      requestBodyBytes: 0,
    })
    if (!admitted.ok) throw new Error('expected admission')
    expect(admitted.permit.startDeadlineAt).toEqual(new Date('2026-08-10T10:00:01.000Z'))

    await expect(
      authority.start(admitted.permit.id, admissionInput().runtimeBinding),
    ).resolves.toMatchObject({ ok: true, permit: { state: 'started' } })
  })

  it('fences a permit when an authorization generation changes before start', async () => {
    const memory = createStore()
    let grantGeneration = 3
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration } }),
    })
    await authority.installApproval(approvalBundle())
    const admitted = await authority.admit(admissionInput())
    if (!admitted.ok) throw new Error('expected admission')
    grantGeneration = 4

    await expect(
      authority.start(admitted.permit.id, admissionInput().runtimeBinding),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('fenced')
  })
  it('fences a started permit at the exact operation deadline', async () => {
    const memory = createStore()
    let currentTime = now
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => currentTime,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })
    await authority.installApproval(approvalBundle())
    const admitted = await authority.admit(admissionInput())
    if (!admitted.ok) throw new Error('expected admission')
    const started = await authority.start(
      admitted.permit.id,
      admissionInput().runtimeBinding,
    )
    if (!started.ok) throw new Error('expected start')
    const operationDeadline = started.permit.operationDeadlineAt
    if (!operationDeadline) throw new Error('expected operation deadline')
    currentTime = operationDeadline

    await expect(
      authority.complete(admitted.permit.id, admissionInput().runtimeBinding),
    ).resolves.toEqual({ ok: false, code: 'operation_deadline_elapsed' })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('fenced')
  })

  it('increments the kill generation, fences active work, and records drain completion', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      verifyRoleApproval: () => true,
      refreshPolicy: freshPolicy(memory),
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })
    await authority.installApproval(approvalBundle())
    await authority.admit(admissionInput())

    await expect(
      authority.denyCapability(
        'property.import_gbp_v2',
        'operator-1',
        'incident containment',
      ),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 5, drained: true })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('fenced')
    expect(memory.isDrained()).toBe(true)
  })
})
