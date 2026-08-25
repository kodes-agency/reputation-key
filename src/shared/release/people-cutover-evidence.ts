import { createHash } from 'node:crypto'
import { z } from 'zod/v4'

export const PEOPLE_CUTOVER_EVIDENCE_VERSION = 'repkey-people-cutover-1' as const

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)
const nonNegativeCount = z.number().int().min(0)

const countsSchema = z
  .object({
    legacyAssignments: nonNegativeCount,
    expectedParticipations: nonNegativeCount,
    matchedParticipations: nonNegativeCount,
    expectedMemberships: nonNegativeCount,
    matchedMemberships: nonNegativeCount,
    expectedResponsibilities: nonNegativeCount,
    matchedResponsibilities: nonNegativeCount,
    expectedGroupMemberships: nonNegativeCount,
    matchedGroupMemberships: nonNegativeCount,
    anomalies: nonNegativeCount,
    missingMappings: nonNegativeCount,
  })
  .strict()

const scopeSchema = z
  .object({
    kind: z.enum(['global', 'organizations']),
    organizationIds: z.array(z.string().min(1).max(255)),
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.kind === 'global' && scope.organizationIds.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['organizationIds'],
        message: 'global evidence cannot carry organization identifiers',
      })
    }
    if (scope.kind === 'organizations' && scope.organizationIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['organizationIds'],
        message: 'organization evidence requires at least one organization identifier',
      })
    }
    const sorted = [...new Set(scope.organizationIds)].sort()
    if (JSON.stringify(scope.organizationIds) !== JSON.stringify(sorted)) {
      context.addIssue({
        code: 'custom',
        path: ['organizationIds'],
        message: 'organization identifiers must be unique and sorted',
      })
    }
  })

const peopleCutoverEvidenceSchema = z
  .object({
    version: z.literal(PEOPLE_CUTOVER_EVIDENCE_VERSION),
    evidenceKind: z.literal('people-authority-cutover'),
    checkedAt: z.iso.datetime({ offset: false }),
    scope: scopeSchema,
    fingerprintSha256: sha256,
    counts: countsSchema,
    operator: z
      .object({
        id: z.string().min(1).max(255),
        correlationId: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const pairs = [
      [
        'participations',
        evidence.counts.expectedParticipations,
        evidence.counts.matchedParticipations,
      ],
      [
        'memberships',
        evidence.counts.expectedMemberships,
        evidence.counts.matchedMemberships,
      ],
      [
        'responsibilities',
        evidence.counts.expectedResponsibilities,
        evidence.counts.matchedResponsibilities,
      ],
      [
        'groupMemberships',
        evidence.counts.expectedGroupMemberships,
        evidence.counts.matchedGroupMemberships,
      ],
    ] as const
    for (const [name, expected, matched] of pairs) {
      if (expected !== matched) {
        context.addIssue({
          code: 'custom',
          path: ['counts', `matched${name[0]!.toUpperCase()}${name.slice(1)}`],
          message: `matched ${name} must equal expected ${name}`,
        })
      }
    }
    if (evidence.counts.anomalies !== 0 || evidence.counts.missingMappings !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message: 'cutover evidence requires exact parity',
      })
    }
  })

export type PeopleCutoverCounts = z.infer<typeof countsSchema>
export type PeopleCutoverScope = z.infer<typeof scopeSchema>
export type PeopleCutoverEvidence = z.infer<typeof peopleCutoverEvidenceSchema>

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

export function createPeopleCutoverEvidence(
  input: Readonly<{
    checkedAt: Date
    scope: PeopleCutoverScope
    fingerprintSha256: string
    counts: PeopleCutoverCounts
    operator: Readonly<{ id: string; correlationId: string }>
  }>,
): PeopleCutoverEvidence {
  const organizationIds = [...new Set(input.scope.organizationIds)].sort()
  return peopleCutoverEvidenceSchema.parse({
    version: PEOPLE_CUTOVER_EVIDENCE_VERSION,
    evidenceKind: 'people-authority-cutover',
    checkedAt: input.checkedAt.toISOString(),
    scope: { kind: input.scope.kind, organizationIds },
    fingerprintSha256: input.fingerprintSha256,
    counts: input.counts,
    operator: input.operator,
  })
}

export function canonicalPeopleCutoverEvidence(value: PeopleCutoverEvidence): string {
  return `${JSON.stringify(sortedJson(value as JsonValue))}\n`
}

export function peopleCutoverEvidenceSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export type PeopleCutoverEvidenceParseResult =
  | Readonly<{
      ok: true
      evidence: PeopleCutoverEvidence
      digest: string
    }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parsePeopleCutoverEvidence(
  content: string,
): PeopleCutoverEvidenceParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['people cutover evidence is not valid JSON'] }
  }
  const parsed = peopleCutoverEvidenceSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'evidence'}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalPeopleCutoverEvidence(parsed.data)
  if (canonical !== content) {
    return {
      ok: false,
      errors: ['people cutover evidence must use canonical JSON encoding'],
    }
  }
  return {
    ok: true,
    evidence: Object.freeze(parsed.data),
    digest: peopleCutoverEvidenceSha256(canonical),
  }
}
