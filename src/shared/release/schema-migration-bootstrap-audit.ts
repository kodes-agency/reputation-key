import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { RAILWAY_DEPLOYMENT_PROFILES } from './railway-deployment-profile'

export const SCHEMA_MIGRATION_BOOTSTRAP_AUDIT_VERSION =
  'repkey-schema-migration-bootstrap-authorization-2' as const
export const SCHEMA_MIGRATION_BOOTSTRAP_POLICY_VERSION =
  'schema-bootstrap-artifact-1' as const

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)
const imageDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/u)

const schemaMigrationBootstrapAuthorizationSchema = z
  .object({
    version: z.literal(SCHEMA_MIGRATION_BOOTSTRAP_AUDIT_VERSION),
    evidenceKind: z.literal('schema-migration-bootstrap-authorization'),
    recordedAt: z.iso.datetime({ offset: false }),
    command: z.literal('release:migrate-cell'),
    correlationId: z.uuid(),
    operator: z.string().trim().min(1).max(255),
    reason: z.string().trim().min(1).max(1_000),
    decision: z
      .object({
        allowed: z.boolean(),
        reason: z.enum(['allowed', 'operator_not_registered']),
        action: z.literal('system:ops'),
        policyVersion: z.literal(SCHEMA_MIGRATION_BOOTSTRAP_POLICY_VERSION),
      })
      .strict(),
    cell: z.literal('us'),
    deploymentProfile: z.enum(RAILWAY_DEPLOYMENT_PROFILES),
    target: z
      .object({
        projectName: z.string().min(1).max(255),
        projectId: z.string().min(1).max(255),
        environment: z.literal('cell-us'),
        environmentId: z.string().min(1).max(255),
      })
      .strict(),
    release: z
      .object({
        manifestSha256: sha256,
        signatureBundleSha256: sha256,
        railwayPlanEvidenceSha256: sha256,
        iacSha256: sha256,
        releaseControllerSha256: sha256,
        migrationHead: z.string().min(1).max(255),
        imageReference: z.string().min(1).max(2_048),
        imageDigest,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision.allowed !== (value.decision.reason === 'allowed')) {
      context.addIssue({
        code: 'custom',
        path: ['decision', 'reason'],
        message: 'decision allowed and reason must agree',
      })
    }
  })

export type SchemaMigrationBootstrapAuthorization = z.infer<
  typeof schemaMigrationBootstrapAuthorizationSchema
>

export function createSchemaMigrationBootstrapAuthorization(
  input: SchemaMigrationBootstrapAuthorization,
): SchemaMigrationBootstrapAuthorization {
  return schemaMigrationBootstrapAuthorizationSchema.parse(input)
}

export function canonicalSchemaMigrationBootstrapAuthorization(
  input: SchemaMigrationBootstrapAuthorization,
): string {
  const parsed = schemaMigrationBootstrapAuthorizationSchema.parse(input)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

export function schemaMigrationBootstrapAuthorizationSha256(
  content: string | Uint8Array,
): string {
  return createHash('sha256').update(content).digest('hex')
}
