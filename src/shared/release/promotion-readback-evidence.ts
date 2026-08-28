/**
 * Structured promotion read-back evidence (REL-01-T5).
 *
 * `release:beta --verify-only` already performs the four strongest promotion
 * checks in the program — Railway graph drift, release identity + health +
 * AI control heads, migration integrity, and dormant Data Cell denial — and
 * then throws the result away into a terminal. Gate F requires all four as
 * evidence keys, so operators were left pasting console output into a file
 * that Gate F accepted because its digest matched.
 *
 * This module gives those four observations a type. One artifact per gate,
 * discriminated on `gate`, each carrying the same `ReleaseCandidateBinding` as
 * every other live promotion proof.
 *
 * Two properties matter more than the field lists:
 *
 * 1. A failing check must still EMIT. The `outcome: 'failed'` artifact is the
 *    honest record of a promotion that was refused; writing nothing would let
 *    an operator retry until a passing artifact appeared and file only that.
 * 2. `outcome: 'passed'` is not representable unless the observations
 *    themselves are clean. The artifact cannot claim more than it observed.
 */

import { z } from 'zod/v4'
import { DATA_CELL_IDS, type DataCellId } from '../domain/data-cell-catalogue'
import {
  canonicalReleaseEvidence,
  parseCanonicalReleaseEvidence,
  releaseCandidateBindingSchema,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from './candidate-bound-evidence'
import {
  RAILWAY_SERVICE_IMAGE_ROLES,
  type RailwayApplicationService,
} from './promotion-manifest'
import { RAILWAY_PLAN_EVIDENCE_VERSION } from './railway-plan-evidence'

export const PROMOTION_READBACK_EVIDENCE_VERSION = 'repkey-promotion-readback-1' as const

export const PROMOTION_READBACK_GATES = [
  'railway_no_drift',
  'release_identity_health_controls',
  'migration_integrity',
  'dormant_cell_denial',
] as const
export type PromotionReadbackGate = (typeof PROMOTION_READBACK_GATES)[number]

/** Read-back gate → the Gate F key it satisfies. */
export const PROMOTION_READBACK_GATE_F_IDS = {
  railway_no_drift: 'promotion.railway_no_drift',
  release_identity_health_controls: 'promotion.release_identity_health_controls',
  migration_integrity: 'promotion.migration_integrity',
  dormant_cell_denial: 'promotion.dormant_cell_denial',
} as const satisfies Readonly<Record<PromotionReadbackGate, string>>

/** The Railway services a promotion touches; identity must hold for all. */
export const PROMOTION_READBACK_SERVICES = Object.freeze(
  (Object.keys(RAILWAY_SERVICE_IMAGE_ROLES) as RailwayApplicationService[])
    .slice()
    .sort(),
)

/** The four `/api/health` probes the release controller requires green. */
export const PROMOTION_HEALTH_PROBES = ['db', 'redis', 'migrations', 'policy'] as const

/** Beta is exactly one logical US Data Cell; every other id must be denied. */
export const DORMANT_DATA_CELL_IDS = Object.freeze(
  DATA_CELL_IDS.filter((id): id is Exclude<DataCellId, 'us'> => id !== 'us'),
)

const MIGRATION_TAG = /^[0-9]{4}_[a-z0-9_]{1,120}$/u
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u
const DEPLOYMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const readbackBaseSchema = z.object({
  version: z.literal(PROMOTION_READBACK_EVIDENCE_VERSION),
  evidenceKind: z.literal('promotion-readback'),
  candidate: releaseCandidateBindingSchema,
  capturedAt: releaseEvidenceTimestampSchema,
  observedBy: releaseEvidenceIdentitySchema,
  /**
   * `verify_only` is a read-back of an already-running environment;
   * `post_deploy` is the read-back taken inside an applying run. Both are
   * legitimate; conflating them is not, because only one of them proves the
   * environment was already settled before the operator looked.
   */
  readbackMode: z.enum(['verify_only', 'post_deploy']),
  outcome: z.enum(['passed', 'failed']),
  failures: z.array(z.string().trim().min(1).max(1024)),
})

const railwayNoDriftSchema = readbackBaseSchema
  .extend({
    gate: z.literal('railway_no_drift'),
    planEvidence: z
      .object({
        version: z.literal(RAILWAY_PLAN_EVIDENCE_VERSION),
        sha256: releaseEvidenceSha256Schema,
        outcome: z.enum(['no-drift', 'pending-changes']),
        capturedAt: releaseEvidenceTimestampSchema,
      })
      .strict(),
    liveGraph: z
      .object({
        confirmedAt: releaseEvidenceTimestampSchema,
        changedServiceCount: z.number().int().safe().nonnegative(),
        unmanagedServiceCount: z.number().int().safe().nonnegative(),
        iacSha256: releaseEvidenceSha256Schema,
        releaseControllerSha256: releaseEvidenceSha256Schema,
      })
      .strict(),
  })
  .strict()

/**
 * Observation fields are deliberately PERMISSIVE at the schema level and
 * constrained in `superRefine` only when `outcome === 'passed'`.
 *
 * The reason is the whole point of this artifact: a failing check must still
 * emit a record. If `sourceRevisionOverride` were `z.literal('')`, a run that
 * FOUND a legacy override could not write its own failure down, and the
 * operator's only option would be to fix the override and re-run — leaving no
 * trace that the refusal ever happened. A passing artifact is exactly as
 * strict as before; a failing one is representable and Gate F still refuses it
 * because its outcome is not `passed`.
 */
const serviceIdentityRowSchema = z
  .object({
    service: z.string().trim().min(1).max(128),
    /** Empty string means the variable was unset on the live service. */
    releaseSha: z.string().max(64),
    releaseManifestSha256: z.string().max(64),
    /** Empty string means the legacy override is absent, which is required. */
    sourceRevisionOverride: z.string().max(128),
    imageSourceRevisionOverride: z.string().max(128),
    activeDeploymentId: z.string().max(64),
    activeImageDigest: z.string().max(128),
  })
  .strict()

const aiControlHeadSchema = z
  .object({
    scopeKey: z.string().trim().min(1).max(128),
    executionState: z.string().trim().min(1).max(64),
    admissionState: z.string().trim().min(1).max(64),
  })
  .strict()

const releaseIdentityHealthControlsSchema = readbackBaseSchema
  .extend({
    gate: z.literal('release_identity_health_controls'),
    services: z.array(serviceIdentityRowSchema).min(PROMOTION_READBACK_SERVICES.length),
    health: z
      .object({
        url: z
          .string()
          .max(512)
          .refine((value) => value.startsWith('https://'), 'must be an HTTPS origin'),
        httpStatus: z.number().int().safe().nonnegative(),
        status: z.string().max(64),
        probes: z
          .object({
            db: z.boolean(),
            redis: z.boolean(),
            migrations: z.boolean(),
            policy: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    aiControlHeads: z.array(aiControlHeadSchema).min(1),
  })
  .strict()

const migrationIntegritySchema = readbackBaseSchema
  .extend({
    gate: z.literal('migration_integrity'),
    drizzle: z
      .object({
        journalPath: z.literal('drizzle/meta/_journal.json'),
        journalSha256: releaseEvidenceSha256Schema,
        headTag: z.string().regex(MIGRATION_TAG),
        entryCount: z.number().int().safe().positive(),
      })
      .strict(),
    schemaMigrator: z
      .object({
        service: z.literal('schema-migrator'),
        deploymentId: z.string().max(64),
        deploymentStatus: z.string().max(64),
        imageDigest: z.string().max(128),
        appliedHeadTag: z.string().max(128),
        settledAt: releaseEvidenceTimestampSchema,
      })
      .strict(),
    /** Expand-only: a PASSING read-back may never observe a physical drop. */
    destructiveStatementCount: z.number().int().safe().nonnegative(),
    compatibilityMirrorsRetained: z.boolean(),
  })
  .strict()

const dormantCellObservationSchema = z
  .object({
    cell: z.enum(DATA_CELL_IDS),
    /** The exact refusal the operator observed. Absence is not a refusal. */
    refusal: z.enum([
      'catalogue_state_denied',
      'no_railway_contract',
      'environment_absent',
    ]),
    probe: z.string().trim().min(1).max(512),
    resolved: z.boolean(),
    observedAt: releaseEvidenceTimestampSchema,
    observationSha256: releaseEvidenceSha256Schema,
  })
  .strict()

const dormantCellDenialSchema = readbackBaseSchema
  .extend({
    gate: z.literal('dormant_cell_denial'),
    observations: z.array(dormantCellObservationSchema).min(DORMANT_DATA_CELL_IDS.length),
  })
  .strict()

const promotionReadbackEvidenceSchema = z
  .discriminatedUnion('gate', [
    railwayNoDriftSchema,
    releaseIdentityHealthControlsSchema,
    migrationIntegritySchema,
    dormantCellDenialSchema,
  ])
  .superRefine((value, context) => {
    if (value.outcome === 'passed' && value.failures.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'passed outcome requires an empty failure list',
      })
    }
    if (value.outcome === 'failed' && value.failures.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['failures'],
        message: 'failed outcome requires at least one failure',
      })
    }

    if (value.gate === 'railway_no_drift') {
      if (value.planEvidence.outcome !== 'no-drift') {
        context.addIssue({
          code: 'custom',
          path: ['planEvidence', 'outcome'],
          message:
            'Railway plan evidence reports pending-changes; the graph is not settled',
        })
      }
      if (
        value.outcome === 'passed' &&
        (value.liveGraph.changedServiceCount !== 0 ||
          value.liveGraph.unmanagedServiceCount !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['liveGraph'],
          message: 'passed drift read-back requires zero changed and unmanaged services',
        })
      }
      if (Date.parse(value.capturedAt) < Date.parse(value.liveGraph.confirmedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['capturedAt'],
          message: 'capture predates the live graph confirmation',
        })
      }
    }

    if (value.gate === 'release_identity_health_controls') {
      const services = value.services.map(({ service }) => service)
      if (new Set(services).size !== services.length) {
        context.addIssue({
          code: 'custom',
          path: ['services'],
          message: 'duplicate service read-back row',
        })
      }
      for (const service of PROMOTION_READBACK_SERVICES) {
        if (!services.includes(service)) {
          context.addIssue({
            code: 'custom',
            path: ['services'],
            message: `missing release identity read-back for ${service}`,
          })
        }
      }
      for (const [index, row] of value.services.entries()) {
        if (value.outcome === 'passed') {
          if (
            row.sourceRevisionOverride !== '' ||
            row.imageSourceRevisionOverride !== ''
          ) {
            context.addIssue({
              code: 'custom',
              path: ['services', index],
              message: `${row.service}: legacy SOURCE_REVISION/IMAGE_SOURCE_REVISION service override must be absent; source identity is baked into the promoted image`,
            })
          }
          if (!DEPLOYMENT_ID.test(row.activeDeploymentId)) {
            context.addIssue({
              code: 'custom',
              path: ['services', index, 'activeDeploymentId'],
              message: `${row.service}: no settled active deployment was observed`,
            })
          }
          if (!IMAGE_DIGEST.test(row.activeImageDigest)) {
            context.addIssue({
              code: 'custom',
              path: ['services', index, 'activeImageDigest'],
              message: `${row.service}: no active image digest was observed`,
            })
          }
        }
        if (row.releaseSha !== value.candidate.releaseSha) {
          context.addIssue({
            code: 'custom',
            path: ['services', index, 'releaseSha'],
            message: `${row.service}: RELEASE_SHA does not match the candidate`,
          })
        }
        if (row.releaseManifestSha256 !== value.candidate.releaseManifestSha256) {
          context.addIssue({
            code: 'custom',
            path: ['services', index, 'releaseManifestSha256'],
            message: `${row.service}: RELEASE_MANIFEST_SHA256 does not match the candidate`,
          })
        }
      }
      if (value.outcome === 'passed') {
        if (value.health.httpStatus !== 200 || value.health.status !== 'ok') {
          context.addIssue({
            code: 'custom',
            path: ['health'],
            message: `health endpoint returned ${String(value.health.httpStatus)} ${value.health.status}`,
          })
        }
        for (const probe of PROMOTION_HEALTH_PROBES) {
          if (!value.health.probes[probe]) {
            context.addIssue({
              code: 'custom',
              path: ['health', 'probes', probe],
              message: `health ${probe} is not green`,
            })
          }
        }
      }
      const scopes = value.aiControlHeads.map(({ scopeKey }) => scopeKey)
      if (new Set(scopes).size !== scopes.length) {
        context.addIssue({
          code: 'custom',
          path: ['aiControlHeads'],
          message: 'duplicate ai_execution_control_heads scope',
        })
      }
      for (const [index, head] of value.aiControlHeads.entries()) {
        if (
          value.outcome === 'passed' &&
          (head.executionState !== 'enabled' || head.admissionState !== 'accepting')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['aiControlHeads', index],
            message: `${head.scopeKey}: ${head.executionState}/${head.admissionState} (want enabled/accepting)`,
          })
        }
      }
    }

    if (value.gate === 'migration_integrity') {
      if (value.outcome === 'passed') {
        if (value.schemaMigrator.deploymentStatus !== 'SUCCESS') {
          context.addIssue({
            code: 'custom',
            path: ['schemaMigrator', 'deploymentStatus'],
            message: 'the schema-migrator deployment is not SUCCESS',
          })
        }
        if (!DEPLOYMENT_ID.test(value.schemaMigrator.deploymentId)) {
          context.addIssue({
            code: 'custom',
            path: ['schemaMigrator', 'deploymentId'],
            message: 'no schema-migrator deployment id was observed',
          })
        }
        if (!IMAGE_DIGEST.test(value.schemaMigrator.imageDigest)) {
          context.addIssue({
            code: 'custom',
            path: ['schemaMigrator', 'imageDigest'],
            message: 'no schema-migrator image digest was observed',
          })
        }
        if (!MIGRATION_TAG.test(value.schemaMigrator.appliedHeadTag)) {
          context.addIssue({
            code: 'custom',
            path: ['schemaMigrator', 'appliedHeadTag'],
            message: 'no applied migration head tag was observed',
          })
        }
        if (value.destructiveStatementCount !== 0) {
          context.addIssue({
            code: 'custom',
            path: ['destructiveStatementCount'],
            message: 'migrations are expand-only; a destructive statement was observed',
          })
        }
        if (!value.compatibilityMirrorsRetained) {
          context.addIssue({
            code: 'custom',
            path: ['compatibilityMirrorsRetained'],
            message: 'a compatibility mirror was removed; migrations are expand-only',
          })
        }
      }
      if (value.schemaMigrator.appliedHeadTag !== value.drizzle.headTag) {
        context.addIssue({
          code: 'custom',
          path: ['schemaMigrator', 'appliedHeadTag'],
          message: 'the deployed migrator head does not match the candidate journal head',
        })
      }
      if (Date.parse(value.capturedAt) < Date.parse(value.schemaMigrator.settledAt)) {
        context.addIssue({
          code: 'custom',
          path: ['capturedAt'],
          message: 'capture predates the schema-migrator settlement',
        })
      }
    }

    if (value.gate === 'dormant_cell_denial') {
      const observed = value.observations.map(({ cell }) => cell)
      if (new Set(observed).size !== observed.length) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'duplicate dormant cell observation',
        })
      }
      if (observed.includes('us')) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'the active us cell is not a dormant cell and must not be denied',
        })
      }
      for (const [index, observation] of value.observations.entries()) {
        if (value.outcome === 'passed' && observation.resolved) {
          context.addIssue({
            code: 'custom',
            path: ['observations', index, 'resolved'],
            message: `dormant cell ${observation.cell} resolved; beta is exactly one logical US Data Cell`,
          })
        }
      }
      for (const cell of DORMANT_DATA_CELL_IDS) {
        if (!observed.includes(cell)) {
          context.addIssue({
            code: 'custom',
            path: ['observations'],
            message: `missing dormant cell refusal observation for ${cell}`,
          })
        }
      }
    }
  })

export type PromotionReadbackEvidence = z.infer<typeof promotionReadbackEvidenceSchema>

export function canonicalPromotionReadbackEvidence(
  evidence: PromotionReadbackEvidence,
): string {
  return canonicalReleaseEvidence(evidence)
}

export function parsePromotionReadbackEvidence(
  content: string,
  expectedGate?: PromotionReadbackGate,
): CanonicalReleaseEvidenceParseResult<PromotionReadbackEvidence> {
  const parsed = parseCanonicalReleaseEvidence({
    content,
    schema: promotionReadbackEvidenceSchema,
    label: 'Promotion read-back evidence',
  })
  if (!parsed.ok || expectedGate === undefined) return parsed
  if (parsed.evidence.gate !== expectedGate) {
    return {
      ok: false,
      errors: [`gate: expected ${expectedGate} read-back, found ${parsed.evidence.gate}`],
    }
  }
  return parsed
}

/** Digests a read-back artifact depends on and its gate must therefore retain. */
export function promotionReadbackDependencyDigests(
  evidence: PromotionReadbackEvidence,
): readonly string[] {
  switch (evidence.gate) {
    case 'railway_no_drift':
      return [evidence.planEvidence.sha256]
    case 'migration_integrity':
      return [evidence.drizzle.journalSha256]
    case 'dormant_cell_denial':
      return evidence.observations.map(({ observationSha256 }) => observationSha256)
    default:
      return []
  }
}

/** The canonical artifact filename for each read-back gate. */
export function promotionReadbackFileName(gate: PromotionReadbackGate): string {
  return `promotion-readback-${gate.replaceAll('_', '-')}.json`
}
