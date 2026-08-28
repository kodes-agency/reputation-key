import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'

export const releaseEvidenceSha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
export const releaseEvidenceSourceRevisionSchema = z.string().regex(/^[0-9a-f]{40}$/u)
export const releaseEvidenceTimestampSchema = z.iso.datetime({ offset: false })
export const releaseEvidenceIdentitySchema = z.string().trim().min(1).max(256)

/**
 * The immutable target identity shared by every live promotion proof. A local,
 * staging, differently hosted, or differently manifested run cannot be
 * re-labelled as production evidence after the fact.
 */
export const releaseCandidateBindingSchema = z
  .object({
    releaseSha: releaseEvidenceSourceRevisionSchema,
    releaseManifestSha256: releaseEvidenceSha256Schema,
    cell: z.literal('us'),
    environment: z.literal('cell-us'),
    deploymentProfile: z.literal('production'),
    projectName: z.literal(PRODUCTION_RAILWAY_PROJECT_NAME),
    projectId: releaseEvidenceIdentitySchema,
    environmentId: releaseEvidenceIdentitySchema,
    appOrigin: z.literal('https://us.reputationkey.app'),
  })
  .strict()

export type ReleaseCandidateBinding = z.infer<typeof releaseCandidateBindingSchema>

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

export function canonicalReleaseEvidence(value: unknown): string {
  return `${JSON.stringify(sortedJson(value as JsonValue))}\n`
}

export function releaseEvidenceSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export type CanonicalReleaseEvidenceParseResult<T> =
  | Readonly<{ ok: true; evidence: T; digest: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parseCanonicalReleaseEvidence<T>(input: {
  content: string
  schema: z.ZodType<T>
  label: string
}): CanonicalReleaseEvidenceParseResult<T> {
  let value: unknown
  try {
    value = JSON.parse(input.content)
  } catch {
    return { ok: false, errors: [`${input.label} is not valid JSON`] }
  }
  const parsed = input.schema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || input.label}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalReleaseEvidence(parsed.data)
  if (canonical !== input.content) {
    return {
      ok: false,
      errors: [`${input.label} must use canonical JSON encoding`],
    }
  }
  return {
    ok: true,
    evidence: parsed.data,
    digest: releaseEvidenceSha256(canonical),
  }
}

export function candidateBindingErrors(
  observed: ReleaseCandidateBinding,
  expected: ReleaseCandidateBinding,
): readonly string[] {
  return (Object.keys(expected) as ReadonlyArray<keyof ReleaseCandidateBinding>).flatMap(
    (key) =>
      observed[key] === expected[key]
        ? []
        : [`candidate.${key}: does not match the Gate F release target`],
  )
}
