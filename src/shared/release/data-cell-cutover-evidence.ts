import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { SINGLE_US_BETA_CUTOVER_KEY } from '#/shared/db/data-cell-topology-fence'

export const DATA_CELL_CUTOVER_EVIDENCE_VERSION = 'repkey-data-cell-cutover-1' as const

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const evidenceSchema = z
  .object({
    version: z.literal(DATA_CELL_CUTOVER_EVIDENCE_VERSION),
    evidenceKind: z.literal('data-cell-topology-cutover'),
    cutoverKey: z.literal(SINGLE_US_BETA_CUTOVER_KEY),
    capturedAt: z.iso.datetime({ offset: false }),
    completedAt: z.iso.datetime({ offset: false }),
    state: z.literal('completed'),
    target: z
      .object({
        cell: z.literal('us'),
        policyVersion: z.literal(3),
        projectId: z.string().trim().min(1).max(255),
        environmentId: z.string().trim().min(1).max(255),
      })
      .strict(),
    progress: z
      .object({
        propertiesProcessed: z.number().int().safe().nonnegative(),
        credentialHomesProcessed: z.number().int().safe().nonnegative(),
        credentialConnectionsProcessed: z.number().int().safe().nonnegative(),
        errorCount: z.literal(0),
      })
      .strict(),
    verification: z
      .object({
        remainingProperties: z.literal(0),
        resolvablePropertiesRemaining: z.literal(0),
        remainingCredentialHomes: z.literal(0),
        // Workflows may legitimately resume after the cutover transaction
        // commits. Retain the locked live count instead of claiming a
        // synthetic zero; the other fields remain completion invariants.
        activeWorkflowBlockers: z.number().int().safe().nonnegative(),
        routingConflicts: z.literal(0),
      })
      .strict(),
    reportDigestSha256: sha256,
    completionDigestSha256: sha256,
    operator: z
      .object({
        id: z.string().min(1).max(255),
        changeTicket: z.string().min(1).max(255),
        correlationId: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.capturedAt) < Date.parse(value.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'capture must not precede completion',
      })
    }
  })

export type DataCellCutoverEvidence = z.infer<typeof evidenceSchema>

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, JsonValue>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortedJson(record[key] ?? null)]),
    )
  }
  return value
}

export function canonicalDataCellCutoverEvidence(
  evidence: DataCellCutoverEvidence,
): string {
  return `${JSON.stringify(sortedJson(evidence as unknown as JsonValue))}\n`
}

export function dataCellCutoverEvidenceSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function createDataCellCutoverEvidence(input: {
  capturedAt: Date
  completedAt: Date
  reportDigestSha256: string
  completionDigestSha256: string
  propertiesProcessed: number
  credentialHomesProcessed: number
  credentialConnectionsProcessed: number
  errorCount: number
  verification: Readonly<{
    remainingProperties: number
    resolvablePropertiesRemaining: number
    remainingCredentialHomes: number
    activeWorkflowBlockers: number
    routingConflicts: number
  }>
  targetProjectId: string
  targetEnvironmentId: string
  operatorId: string
  changeTicket: string
  correlationId: string
}): DataCellCutoverEvidence {
  return evidenceSchema.parse({
    version: DATA_CELL_CUTOVER_EVIDENCE_VERSION,
    evidenceKind: 'data-cell-topology-cutover',
    cutoverKey: SINGLE_US_BETA_CUTOVER_KEY,
    capturedAt: input.capturedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    state: 'completed',
    target: {
      cell: 'us',
      policyVersion: 3,
      projectId: input.targetProjectId,
      environmentId: input.targetEnvironmentId,
    },
    progress: {
      propertiesProcessed: input.propertiesProcessed,
      credentialHomesProcessed: input.credentialHomesProcessed,
      credentialConnectionsProcessed: input.credentialConnectionsProcessed,
      errorCount: input.errorCount,
    },
    verification: input.verification,
    reportDigestSha256: input.reportDigestSha256,
    completionDigestSha256: input.completionDigestSha256,
    operator: {
      id: input.operatorId,
      changeTicket: input.changeTicket,
      correlationId: input.correlationId,
    },
  })
}

export type DataCellCutoverEvidenceParseResult =
  | Readonly<{ ok: true; evidence: DataCellCutoverEvidence; digest: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parseDataCellCutoverEvidence(
  content: string,
): DataCellCutoverEvidenceParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['Data Cell cutover evidence is not valid JSON'] }
  }
  const parsed = evidenceSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'evidence'}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalDataCellCutoverEvidence(parsed.data)
  if (canonical !== content) {
    return {
      ok: false,
      errors: ['Data Cell cutover evidence must use canonical JSON encoding'],
    }
  }
  return {
    ok: true,
    evidence: Object.freeze(parsed.data),
    digest: dataCellCutoverEvidenceSha256(canonical),
  }
}
