import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  capabilityComplianceApprovals,
  capabilityExecutionControl,
  credentialRevokePermits,
  googleCredentialSourceOperations,
  policyVersion,
} from '#/shared/db/schema'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  GOOGLE_CONTENT_APPROVAL_TARGET_PHASES,
  GOOGLE_CONTENT_CAPABILITIES,
  GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_CONTENT_POLICY_VERSION,
  GOOGLE_CONTENT_ENVIRONMENT_PROFILES,
  GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION,
  GOOGLE_OAUTH_CONTRACT_VERSION,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
} from '#/shared/auth/google-content-contract'
import {
  canonicalGoogleContentSha256,
  type GoogleContentApprovalCandidate,
} from '#/shared/auth/google-content-approval'
import type {
  GoogleContentApprovalRecord,
  GoogleContentAuthorityStore,
  GoogleContentPermitRecord,
  GoogleContentRuntimeBinding,
} from '#/shared/auth/google-content-authority'
import type { AuthorizationExecutionPermit } from '#/shared/auth/authorization-execution-permit'

const roleDocumentSchema = z
  .object({
    role: z.enum(GOOGLE_CONTENT_APPROVAL_ROLES),
    capability: z.enum(GOOGLE_CONTENT_CAPABILITIES),
    manifestSha256: z.string().min(1),
    releaseSha: z.string().min(1),
    targetPhase: z.enum(GOOGLE_CONTENT_APPROVAL_TARGET_PHASES),
    environmentProfile: z.enum(GOOGLE_CONTENT_ENVIRONMENT_PROFILES),
    transientPerformanceReportingDecision: z.enum(['approved', 'denied']),
    confirmedImportProfileTreatmentDecision: z.enum(['approved', 'denied']),
    unmanagedUserAgentMemoryResidualDecision: z.enum(['approved', 'denied']),
    railwayClosedBetaResidualDecision: z.enum(['approved', 'denied']).nullable(),
    railwayClosedBetaCohortSha256: z.string().nullable(),
    railwayClosedBetaResidualRiskSha256: z.string().nullable(),
    approverIdentity: z.string().min(1),
    approvedAt: z.string().min(1),
    expiresAt: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict()

const roleApprovalSchema = z
  .object({
    sha256: z.string().min(1),
    document: roleDocumentSchema,
  })
  .strict()

const evidenceIndexSchema = z
  .object({
    sha256: z.string().min(1),
    manifestSha256: z.string().min(1),
    artifactSha256: z.record(z.string(), z.string()),
    roleDocumentSha256: z.object({
      'engineering/runtime': z.string().min(1),
      'product/property': z.string().min(1),
      'security/privacy': z.string().min(1),
      'google-project/integration': z.string().min(1),
      'operations/on-call': z.string().min(1),
    }),
  })
  .strict()

const imageDigestsSchema = z
  .object({
    web: z.string().min(1),
    worker: z.string().min(1),
    googleExecutionAdmission: z.string().min(1),
    googleEgressGateway: z.string().min(1),
    providerEphemeralRedis: z.string().min(1),
  })
  .strict()

const authorizationVectorSchema = z.record(
  z.string(),
  z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
)
const emergencyKillVersionRowSchema = z.object({
  emergency_kill_version: z.union([z.number(), z.string().regex(/^[0-9]+$/)]),
})
const countRowSchema = z.object({
  value: z.union([z.number(), z.string().regex(/^[0-9]+$/)]),
})

type ApprovalRow = typeof capabilityComplianceApprovals.$inferSelect
type PermitRow = typeof authorizationExecutionPermits.$inferSelect
export function runtimeBindingFromApprovalRow(
  row: ApprovalRow,
): GoogleContentRuntimeBinding {
  // Version columns are varchar so obsolete persisted values survive upgrades.
  // Preserve those raw values for the explainer even though the current
  // runtime-binding type narrows each version to its compiled literal.
  return {
    capability: row.capability,
    targetPhase: row.targetPhase,
    environmentProfile: row.environmentProfile,
    releaseSha: row.releaseSha,
    evidenceManifestSha256: row.evidenceManifestSha256,
    evidenceIndexSha256: row.evidenceIndexSha256,
    deploymentAttestationSha256: row.deploymentAttestationSha256,
    adr0050Sha256: row.adr0050Sha256,
    googleContentPolicyVersion:
      row.googleContentPolicyVersion as GoogleContentRuntimeBinding['googleContentPolicyVersion'],
    googleOAuthContractVersion:
      row.googleOauthContractVersion as GoogleContentRuntimeBinding['googleOAuthContractVersion'],
    googleProjectAttestationSha256: row.googleProjectAttestationSha256,
    googleOAuthClientIdSha256: row.googleOauthClientIdSha256,
    googleRedirectUriSha256: row.googleRedirectUriSha256,
    providerOriginProfileSha256: row.providerOriginProfileSha256,
    runtimeIsolationProfileVersion:
      row.runtimeIsolationProfileVersion as GoogleContentRuntimeBinding['runtimeIsolationProfileVersion'],
    runtimeIsolationProfileSha256: row.runtimeIsolationProfileSha256,
    railwayClosedBetaCohort: row.railwayClosedBetaCohort,
    railwayClosedBetaCohortSha256: row.railwayClosedBetaCohortSha256,
    railwayClosedBetaResidualRiskSha256: row.railwayClosedBetaResidualRiskSha256,
    performanceCatalogVersion:
      row.performanceCatalogVersion as GoogleContentRuntimeBinding['performanceCatalogVersion'],
    routeCatalogueVersion:
      row.routeCatalogueVersion as GoogleContentRuntimeBinding['routeCatalogueVersion'],
    capabilityPolicyVersion:
      row.capabilityPolicyVersion as GoogleContentRuntimeBinding['capabilityPolicyVersion'],
    executionPolicyVersion:
      row.executionPolicyVersion as GoogleContentRuntimeBinding['executionPolicyVersion'],
    migrationHead: row.migrationHead,
    imageDigests: row.imageDigests,
  }
}

export function approvalRecordFromRow(
  row: ApprovalRow,
): GoogleContentApprovalRecord | null {
  const index = evidenceIndexSchema.safeParse(row.evidenceIndex)
  const roleDocuments = z.array(roleApprovalSchema).safeParse(row.roleApprovals)
  const imageDigests = imageDigestsSchema.safeParse(row.imageDigests)
  if (!index.success || !roleDocuments.success || !imageDigests.success) return null
  if (
    row.googleContentPolicyVersion !== GOOGLE_CONTENT_POLICY_VERSION ||
    row.googleOauthContractVersion !== GOOGLE_OAUTH_CONTRACT_VERSION ||
    (row.runtimeIsolationProfileVersion !== null &&
      row.runtimeIsolationProfileVersion !==
        GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION) ||
    row.performanceCatalogVersion !== GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION ||
    // Fails closed on route-catalogue drift: a persisted approval minted for an
    // older catalogue no longer resolves, so the capability denies
    // approval_unavailable until a re-approved bundle is installed.
    row.routeCatalogueVersion !== GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION ||
    row.capabilityPolicyVersion !== GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION ||
    row.executionPolicyVersion !== GOOGLE_CONTENT_EXECUTION_POLICY_VERSION
  ) {
    return null
  }

  const candidate: GoogleContentApprovalCandidate = {
    binding: {
      ...runtimeBindingFromApprovalRow(row),
      imageDigests: imageDigests.data,
      approvedAt: row.approvedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      status: row.status,
    },
    index: index.data,
    roleDocuments: roleDocuments.data,
  }
  return { id: row.id, candidate }
}

function permitRecordFromRow(row: PermitRow): GoogleContentPermitRecord | null {
  const authorizationVector = authorizationVectorSchema.safeParse(row.authorizationVector)
  if (!authorizationVector.success) return null
  const permit: AuthorizationExecutionPermit = {
    id: row.id,
    capability: row.capability,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    connectionId: row.connectionId,
    initiatorUserId: row.initiatorUserId,
    operationKey: row.operationKey,
    routeKey: row.routeKey,
    routeCatalogVersion: row.routeCatalogVersion,
    quotaPolicyId: row.quotaPolicyId,
    policyVersion: row.policyVersion,
    emergencyKillVersion: row.emergencyKillVersion,
    approvalBindingId: row.approvalBindingId,
    permitGeneration: row.permitGeneration,
    startVectorMode: row.startVectorMode,
    commitVectorMode: row.commitVectorMode,
    state: row.state,
    admittedAt: row.admittedAt,
    startDeadlineAt: row.startDeadlineAt,
    startedAt: row.startedAt,
    operationDeadlineAt: row.operationDeadlineAt,
    completedAt: row.completedAt,
    fencedAt: row.fencedAt,
  }
  return { permit, authorizationVector: authorizationVector.data }
}

export function approvalIdentityWhere(runtime: GoogleContentRuntimeBinding) {
  return and(
    eq(capabilityComplianceApprovals.capability, runtime.capability),
    eq(capabilityComplianceApprovals.targetPhase, runtime.targetPhase),
    eq(capabilityComplianceApprovals.environmentProfile, runtime.environmentProfile),
  )
}

/**
 * A deployment may briefly run the previous and next immutable images at the
 * same time. Approval identity alone is therefore insufficient: selecting the
 * newest row for the capability would make the previous process observe a row
 * signed for the next process and deny with runtime_binding_mismatch. Keep the
 * query on the indexed capability/phase/profile prefix, then match every
 * runtime-owned field exactly (including the JSON binding members).
 */
function approvalRuntimeWhere(runtime: GoogleContentRuntimeBinding) {
  return and(
    approvalIdentityWhere(runtime),
    eq(capabilityComplianceApprovals.releaseSha, runtime.releaseSha),
    eq(
      capabilityComplianceApprovals.evidenceManifestSha256,
      runtime.evidenceManifestSha256,
    ),
    eq(capabilityComplianceApprovals.evidenceIndexSha256, runtime.evidenceIndexSha256),
    eq(
      capabilityComplianceApprovals.deploymentAttestationSha256,
      runtime.deploymentAttestationSha256,
    ),
    eq(capabilityComplianceApprovals.adr0050Sha256, runtime.adr0050Sha256),
    eq(
      capabilityComplianceApprovals.googleContentPolicyVersion,
      runtime.googleContentPolicyVersion,
    ),
    eq(
      capabilityComplianceApprovals.googleOauthContractVersion,
      runtime.googleOAuthContractVersion,
    ),
    eq(
      capabilityComplianceApprovals.googleProjectAttestationSha256,
      runtime.googleProjectAttestationSha256,
    ),
    eq(
      capabilityComplianceApprovals.googleOauthClientIdSha256,
      runtime.googleOAuthClientIdSha256,
    ),
    eq(
      capabilityComplianceApprovals.googleRedirectUriSha256,
      runtime.googleRedirectUriSha256,
    ),
    eq(
      capabilityComplianceApprovals.providerOriginProfileSha256,
      runtime.providerOriginProfileSha256,
    ),
    runtime.runtimeIsolationProfileVersion === null
      ? isNull(capabilityComplianceApprovals.runtimeIsolationProfileVersion)
      : eq(
          capabilityComplianceApprovals.runtimeIsolationProfileVersion,
          runtime.runtimeIsolationProfileVersion,
        ),
    runtime.runtimeIsolationProfileSha256 === null
      ? isNull(capabilityComplianceApprovals.runtimeIsolationProfileSha256)
      : eq(
          capabilityComplianceApprovals.runtimeIsolationProfileSha256,
          runtime.runtimeIsolationProfileSha256,
        ),
    runtime.railwayClosedBetaCohort === null
      ? isNull(capabilityComplianceApprovals.railwayClosedBetaCohort)
      : eq(
          capabilityComplianceApprovals.railwayClosedBetaCohort,
          runtime.railwayClosedBetaCohort,
        ),
    runtime.railwayClosedBetaCohortSha256 === null
      ? isNull(capabilityComplianceApprovals.railwayClosedBetaCohortSha256)
      : eq(
          capabilityComplianceApprovals.railwayClosedBetaCohortSha256,
          runtime.railwayClosedBetaCohortSha256,
        ),
    runtime.railwayClosedBetaResidualRiskSha256 === null
      ? isNull(capabilityComplianceApprovals.railwayClosedBetaResidualRiskSha256)
      : eq(
          capabilityComplianceApprovals.railwayClosedBetaResidualRiskSha256,
          runtime.railwayClosedBetaResidualRiskSha256,
        ),
    eq(
      capabilityComplianceApprovals.performanceCatalogVersion,
      runtime.performanceCatalogVersion,
    ),
    eq(
      capabilityComplianceApprovals.routeCatalogueVersion,
      runtime.routeCatalogueVersion,
    ),
    eq(
      capabilityComplianceApprovals.capabilityPolicyVersion,
      runtime.capabilityPolicyVersion,
    ),
    eq(
      capabilityComplianceApprovals.executionPolicyVersion,
      runtime.executionPolicyVersion,
    ),
    eq(capabilityComplianceApprovals.migrationHead, runtime.migrationHead),
    eq(capabilityComplianceApprovals.imageDigests, runtime.imageDigests),
  )
}

export async function latestApprovalRow(
  tx: Database,
  runtime: GoogleContentRuntimeBinding,
): Promise<ApprovalRow | null> {
  const rows = await tx
    .select()
    .from(capabilityComplianceApprovals)
    .where(approvalRuntimeWhere(runtime))
    .orderBy(desc(capabilityComplianceApprovals.bindingVersion))
    .limit(1)
  return rows[0] ?? null
}

async function persistApproval(
  tx: Database,
  candidate: GoogleContentApprovalCandidate,
  idempotent: boolean,
): Promise<Readonly<{ record: GoogleContentApprovalRecord; inserted: boolean }>> {
  const binding = candidate.binding
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`${binding.capability}:${binding.targetPhase}:${binding.environmentProfile}`},
    0
  ))`)
  if (idempotent) {
    const existingRow = await latestApprovalRow(tx, binding)
    if (existingRow) {
      const existing = approvalRecordFromRow(existingRow)
      if (!existing) throw new Error('invalid persisted Google Content approval')
      if (
        canonicalGoogleContentSha256(existing.candidate) !==
        canonicalGoogleContentSha256(candidate)
      ) {
        throw new Error('google_content_approval_runtime_binding_conflict')
      }
      return Object.freeze({ record: existing, inserted: false })
    }
  }
  const versions = await tx
    .select({
      value: sql<number>`COALESCE(MAX(${capabilityComplianceApprovals.bindingVersion}), 0)`,
    })
    .from(capabilityComplianceApprovals)
    .where(approvalIdentityWhere(binding))
  const bindingVersion = Number(versions[0]?.value ?? 0) + 1
  const rows = await tx
    .insert(capabilityComplianceApprovals)
    .values({
      bindingVersion,
      capability: binding.capability,
      targetPhase: binding.targetPhase,
      environmentProfile: binding.environmentProfile,
      releaseSha: binding.releaseSha,
      evidenceManifestSha256: binding.evidenceManifestSha256,
      evidenceIndexSha256: binding.evidenceIndexSha256,
      evidenceIndex: candidate.index,
      deploymentAttestationSha256: binding.deploymentAttestationSha256,
      adr0050Sha256: binding.adr0050Sha256,
      googleContentPolicyVersion: binding.googleContentPolicyVersion,
      googleOauthContractVersion: binding.googleOAuthContractVersion,
      googleProjectAttestationSha256: binding.googleProjectAttestationSha256,
      googleOauthClientIdSha256: binding.googleOAuthClientIdSha256,
      googleRedirectUriSha256: binding.googleRedirectUriSha256,
      providerOriginProfileSha256: binding.providerOriginProfileSha256,
      runtimeIsolationProfileVersion: binding.runtimeIsolationProfileVersion,
      runtimeIsolationProfileSha256: binding.runtimeIsolationProfileSha256,
      railwayClosedBetaCohort: binding.railwayClosedBetaCohort,
      railwayClosedBetaCohortSha256: binding.railwayClosedBetaCohortSha256,
      railwayClosedBetaResidualRiskSha256: binding.railwayClosedBetaResidualRiskSha256,
      performanceCatalogVersion: binding.performanceCatalogVersion,
      routeCatalogueVersion: binding.routeCatalogueVersion,
      capabilityPolicyVersion: binding.capabilityPolicyVersion,
      executionPolicyVersion: binding.executionPolicyVersion,
      migrationHead: binding.migrationHead,
      imageDigests: binding.imageDigests,
      roleApprovals: candidate.roleDocuments,
      approvedAt: new Date(binding.approvedAt),
      expiresAt: new Date(binding.expiresAt),
      status: binding.status,
    })
    .returning()
  const record = rows[0] ? approvalRecordFromRow(rows[0]) : null
  if (!record) throw new Error('invalid persisted Google Content approval')
  await tx.execute(sql`
    INSERT INTO policy_version (scope, version, emergency_kill_version, updated_at)
    VALUES ('global', 1, 0, ${new Date(binding.approvedAt)})
    ON CONFLICT (scope) DO UPDATE
    SET version = policy_version.version + 1,
        updated_at = EXCLUDED.updated_at
  `)
  return Object.freeze({ record, inserted: true })
}

export type GoogleContentAuthorityRepository = GoogleContentAuthorityStore<Database> &
  Readonly<{
    ensureApproval(
      tx: Database,
      candidate: GoogleContentApprovalCandidate,
    ): Promise<Readonly<{ record: GoogleContentApprovalRecord; inserted: boolean }>>
  }>

export const createGoogleContentAuthorityRepository = (
  db: Database,
): GoogleContentAuthorityRepository => {
  return {
    transaction: (run) => db.transaction((tx) => run(tx as unknown as Database)),

    loadControl: async (tx) => {
      const rows = await tx
        .select({
          policyVersion: policyVersion.version,
          emergencyKillVersion: policyVersion.emergencyKillVersion,
        })
        .from(policyVersion)
        .where(eq(policyVersion.scope, 'global'))
        .limit(1)
      const controls = await tx
        .select({
          capability: capabilityExecutionControl.capability,
          denied: capabilityExecutionControl.denied,
        })
        .from(capabilityExecutionControl)
      const explicitlyAllowed = new Set(
        controls.filter((row) => !row.denied).map((row) => row.capability),
      )
      return {
        policyVersion: rows[0]?.policyVersion ?? 0,
        emergencyKillVersion: rows[0]?.emergencyKillVersion ?? 0,
        killedCapabilities: GOOGLE_CONTENT_CAPABILITIES.filter(
          (capability) => !explicitlyAllowed.has(capability),
        ),
      }
    },

    appendApproval: async (tx, candidate) =>
      (await persistApproval(tx, candidate, false)).record,

    ensureApproval: (tx, candidate) => persistApproval(tx, candidate, true),

    loadApprovalForRuntime: async (tx, runtime) => {
      const row = await latestApprovalRow(tx, runtime)
      return row ? approvalRecordFromRow(row) : null
    },

    loadApprovalById: async (tx, id) => {
      const rows = await tx
        .select()
        .from(capabilityComplianceApprovals)
        .where(eq(capabilityComplianceApprovals.id, id))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      // Retained IDs remain valid authority for permits admitted against that
      // exact immutable binding. The authority revalidates the row's window,
      // signature, policy generation and caller runtime before start/complete.
      return approvalRecordFromRow(row)
    },

    nextPermitGeneration: async (tx, input) => {
      const scopeKey = [
        input.capability,
        input.scope.organizationId,
        input.scope.propertyId ?? '-',
        input.scope.connectionId ?? '-',
        input.operationKey,
      ].join(':')
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`,
      )
      const where = and(
        eq(authorizationExecutionPermits.capability, input.capability),
        eq(authorizationExecutionPermits.organizationId, input.scope.organizationId),
        input.scope.propertyId === null
          ? isNull(authorizationExecutionPermits.propertyId)
          : eq(authorizationExecutionPermits.propertyId, input.scope.propertyId),
        input.scope.connectionId === null
          ? isNull(authorizationExecutionPermits.connectionId)
          : eq(authorizationExecutionPermits.connectionId, input.scope.connectionId),
        eq(authorizationExecutionPermits.operationKey, input.operationKey),
      )
      const rows = await tx
        .select({
          value: sql<number>`COALESCE(MAX(${authorizationExecutionPermits.permitGeneration}), 0)`,
        })
        .from(authorizationExecutionPermits)
        .where(where)
      return Number(rows[0]?.value ?? 0) + 1
    },

    insertPermit: async (tx, record) => {
      const permit = record.permit
      await tx.insert(authorizationExecutionPermits).values({
        id: permit.id,
        capability: permit.capability,
        organizationId: permit.organizationId,
        propertyId: permit.propertyId,
        connectionId: permit.connectionId,
        initiatorUserId: permit.initiatorUserId,
        operationKey: permit.operationKey,
        routeKey: permit.routeKey,
        routeCatalogVersion: permit.routeCatalogVersion,
        quotaPolicyId: permit.quotaPolicyId,
        policyVersion: permit.policyVersion,
        emergencyKillVersion: permit.emergencyKillVersion,
        approvalBindingId: permit.approvalBindingId,
        permitGeneration: permit.permitGeneration,
        startVectorMode: permit.startVectorMode,
        commitVectorMode: permit.commitVectorMode,
        authorizationVector: record.authorizationVector,
        state: permit.state,
        admittedAt: permit.admittedAt,
        startDeadlineAt: permit.startDeadlineAt,
        startedAt: permit.startedAt,
        operationDeadlineAt: permit.operationDeadlineAt,
        completedAt: permit.completedAt,
        fencedAt: permit.fencedAt,
      })
    },

    lockPermit: async (tx, id) => {
      const rows = await tx
        .select()
        .from(authorizationExecutionPermits)
        .where(eq(authorizationExecutionPermits.id, id))
        .for('update')
        .limit(1)
      return rows[0] ? permitRecordFromRow(rows[0]) : null
    },

    // Candidate scan for the start-deadline sweeper. Selection only: the fence
    // decision is re-made under `lockPermit` by the domain helper, so this
    // predicate never becomes a second source of truth for the deadline.
    // The capability scope makes `authorization_execution_permits_active_idx`
    // (capability, state, start_deadline_at, ...) usable from its leading
    // column; without it this would sequential-scan a table that grows with
    // every provider call. Bounded by the caller's per-run limit, oldest
    // deadline first so a backlog drains deterministically across runs.
    listElapsedAdmittedPermitIds: async (tx, input) => {
      if (input.capabilities.length === 0) return []
      const rows = await tx
        .select({ id: authorizationExecutionPermits.id })
        .from(authorizationExecutionPermits)
        .where(
          and(
            inArray(authorizationExecutionPermits.capability, [...input.capabilities]),
            eq(authorizationExecutionPermits.state, 'admitted'),
            lt(authorizationExecutionPermits.startDeadlineAt, input.before),
          ),
        )
        .orderBy(authorizationExecutionPermits.startDeadlineAt)
        .limit(input.limit)
      return rows.map((row) => row.id)
    },

    updatePermit: async (tx, permit) => {
      await tx
        .update(authorizationExecutionPermits)
        .set({
          state: permit.state,
          startedAt: permit.startedAt,
          operationDeadlineAt: permit.operationDeadlineAt,
          completedAt: permit.completedAt,
          fencedAt: permit.fencedAt,
        })
        .where(eq(authorizationExecutionPermits.id, permit.id))
    },

    denyCapability: async (tx, capability, input) => {
      const result = await tx.execute(sql`
        INSERT INTO policy_version (scope, version, emergency_kill_version, updated_at)
        VALUES ('global', 0, 1, ${input.deniedAt})
        ON CONFLICT (scope) DO UPDATE
        SET emergency_kill_version = policy_version.emergency_kill_version + 1,
            updated_at = EXCLUDED.updated_at
        RETURNING emergency_kill_version
      `)
      const versionRow = emergencyKillVersionRowSchema.parse(result.rows[0])
      const emergencyKillVersion = Number(versionRow.emergency_kill_version)
      await tx
        .insert(capabilityExecutionControl)
        .values({
          capability,
          denied: true,
          emergencyKillVersion,
          deniedAt: input.deniedAt,
          drainedAt: null,
          cleanupDrainedAt: null,
          operatorId: input.operatorId,
          reason: input.reason,
          updatedAt: input.deniedAt,
        })
        .onConflictDoUpdate({
          target: capabilityExecutionControl.capability,
          set: {
            denied: true,
            emergencyKillVersion,
            deniedAt: input.deniedAt,
            drainedAt: null,
            cleanupDrainedAt: null,
            operatorId: input.operatorId,
            reason: input.reason,
            updatedAt: input.deniedAt,
          },
        })
      // The global generation fences races; every capability row must observe
      // the same generation or unrelated capabilities fail closed.
      await tx.update(capabilityExecutionControl).set({ emergencyKillVersion })
      return emergencyKillVersion
    },

    allowCapability: async (tx, capability, input) => {
      const result = await tx.execute(sql`
        INSERT INTO policy_version (scope, version, emergency_kill_version, updated_at)
        VALUES ('global', 0, 1, ${input.changedAt})
        ON CONFLICT (scope) DO UPDATE
        SET emergency_kill_version = policy_version.emergency_kill_version + 1,
            updated_at = EXCLUDED.updated_at
        RETURNING emergency_kill_version
      `)
      const versionRow = emergencyKillVersionRowSchema.parse(result.rows[0])
      const emergencyKillVersion = Number(versionRow.emergency_kill_version)
      await tx
        .insert(capabilityExecutionControl)
        .values({
          capability,
          denied: false,
          emergencyKillVersion,
          deniedAt: null,
          drainedAt: null,
          cleanupDrainedAt: null,
          operatorId: input.operatorId,
          reason: input.reason,
          updatedAt: input.changedAt,
        })
        .onConflictDoUpdate({
          target: capabilityExecutionControl.capability,
          set: {
            denied: false,
            emergencyKillVersion,
            deniedAt: null,
            drainedAt: null,
            cleanupDrainedAt: null,
            operatorId: input.operatorId,
            reason: input.reason,
            updatedAt: input.changedAt,
          },
        })
      // Preserve capability-local allow/deny state while advancing the shared
      // emergency generation used by transactional authorization checks.
      await tx.update(capabilityExecutionControl).set({ emergencyKillVersion })
      return emergencyKillVersion
    },

    fenceActivePermits: async (tx, capability, at) => {
      await tx
        .update(authorizationExecutionPermits)
        .set({ state: 'fenced', fencedAt: at })
        .where(
          and(
            eq(authorizationExecutionPermits.capability, capability),
            inArray(authorizationExecutionPermits.state, ['admitted', 'started']),
          ),
        )
    },

    hasActiveCapabilityWork: async (tx, capability) => {
      const rows = await tx
        .select({ value: sql<number>`COUNT(*)` })
        .from(authorizationExecutionPermits)
        .where(
          and(
            eq(authorizationExecutionPermits.capability, capability),
            inArray(authorizationExecutionPermits.state, ['admitted', 'started']),
          ),
        )
      return Number(rows[0]?.value ?? 0) > 0
    },

    hasActiveCleanupWork: async (tx, capability) => {
      const result = await tx.execute(sql`
        SELECT COUNT(*) AS value
        FROM ${credentialRevokePermits} revoke
        JOIN ${googleCredentialSourceOperations} source
          ON source.id = revoke.source_operation_id
        JOIN ${authorizationExecutionPermits} permit
          ON permit.id = source.source_work_permit_id
        WHERE permit.capability = ${capability}::google_content_capability
          AND revoke.state IN ('active', 'dispatching', 'cleanup_ambiguous')
      `)
      const countRow = countRowSchema.parse(result.rows[0])
      return Number(countRow.value) > 0
    },

    markCapabilityDrained: async (tx, capability, at, input) => {
      await tx
        .update(capabilityExecutionControl)
        .set({
          drainedAt: input.workDrained ? at : undefined,
          cleanupDrainedAt: input.cleanupDrained ? at : undefined,
          updatedAt: at,
        })
        .where(
          and(
            eq(capabilityExecutionControl.capability, capability),
            eq(capabilityExecutionControl.denied, true),
          ),
        )
    },
  }
}
