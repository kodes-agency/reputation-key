// REG-02 — reviewable drift-plan evidence for a Railway Data Cell.
//
// `docs/operations/railway-data-cells.md` § Validation requires the plan to be
// taken against the repository graph with `--detailed-exit-code --json`, and
// the redacted result plus its SHA-256 to be retained beside release evidence.
// Applying is a separate operator action, so the artifact this module produces
// is the thing an operator reviews BEFORE approving an apply.
//
// Redaction is fail-closed: every leaf string is fingerprinted unless its key
// is on the explicit structural allowlist. A new value-bearing key added by
// Railway is therefore redacted by default rather than leaked by default.

import { createHash } from 'node:crypto'
import { z } from 'zod/v4'

export const RAILWAY_PLAN_EVIDENCE_VERSION = 'repkey-railway-plan-1' as const

/** Exit contract of `railway config plan --detailed-exit-code`. */
export const RAILWAY_PLAN_EXIT_NO_DRIFT = 0
export const RAILWAY_PLAN_EXIT_PENDING_CHANGES = 2

export type RailwayPlanOutcome = 'no-drift' | 'pending-changes'

/**
 * Keys whose string values stay readable in evidence. Everything else is
 * fingerprinted. These are placement and identity fields the operator must be
 * able to read to review a plan; none of them carry credentials.
 */
export const RAILWAY_PLAN_STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  'action',
  'environment',
  'environmentId',
  'environmentName',
  'field',
  'id',
  'kind',
  'name',
  'operation',
  'path',
  'project',
  'projectId',
  'projectName',
  'reason',
  'region',
  'resource',
  'resourceType',
  'service',
  'serviceId',
  'serviceName',
  'status',
  'type',
])

const sha256Pattern = /^[0-9a-f]{64}$/u
const sha256 = z.string().regex(sha256Pattern)

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const railwayPlanEvidenceSchema = z
  .object({
    version: z.literal(RAILWAY_PLAN_EVIDENCE_VERSION),
    evidenceKind: z.literal('railway-data-cell-plan'),
    capturedAt: z.iso.datetime({ offset: false }),
    cell: z.string().min(1).max(64),
    target: z
      .object({
        projectId: z.string().min(1).max(255),
        environment: z.string().min(1).max(255),
        environmentId: z.string().min(1).max(255),
      })
      .strict(),
    iac: z.object({ sha256 }).strict(),
    plan: z
      .object({
        exitCode: z.union([
          z.literal(RAILWAY_PLAN_EXIT_NO_DRIFT),
          z.literal(RAILWAY_PLAN_EXIT_PENDING_CHANGES),
        ]),
        outcome: z.enum(['no-drift', 'pending-changes']),
        rawSha256: sha256,
        redacted: jsonValueSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const expected = classifyRailwayPlanExit(evidence.plan.exitCode)
    if (expected !== evidence.plan.outcome) {
      context.addIssue({
        code: 'custom',
        path: ['plan', 'outcome'],
        message: `outcome ${evidence.plan.outcome} does not match exit code ${evidence.plan.exitCode}`,
      })
    }
  })

export type RailwayPlanEvidence = z.infer<typeof railwayPlanEvidenceSchema>

/**
 * Map a `--detailed-exit-code` result. Any code other than the two documented
 * ones blocks promotion and must not become evidence, so it throws rather than
 * producing a record that looks reviewable.
 */
export function classifyRailwayPlanExit(exitCode: number): RailwayPlanOutcome {
  if (exitCode === RAILWAY_PLAN_EXIT_NO_DRIFT) return 'no-drift'
  if (exitCode === RAILWAY_PLAN_EXIT_PENDING_CHANGES) return 'pending-changes'
  throw new Error(
    `Railway plan exit ${exitCode} blocks promotion; only ${RAILWAY_PLAN_EXIT_NO_DRIFT} and ${RAILWAY_PLAN_EXIT_PENDING_CHANGES} are reviewable outcomes`,
  )
}

/**
 * Build the exact plan argv. `--show-values` would defeat redaction at the
 * source, so it is refused here rather than filtered downstream.
 */
export function railwayPlanArgs(
  input: Readonly<{ iacFile: string; extraArgs?: readonly string[] }>,
): readonly string[] {
  const extra = input.extraArgs ?? []
  const rejected = extra.find(
    (arg) => arg === '--show-values' || arg.startsWith('--show-values='),
  )
  if (rejected !== undefined) {
    throw new Error('--show-values must never be used for plan evidence')
  }
  return Object.freeze([
    'config',
    'plan',
    '--file',
    input.iacFile,
    '--detailed-exit-code',
    '--json',
    ...extra,
  ])
}

export function railwayPlanValueFingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

/**
 * Structure-preserving redaction. Keys, shape, numbers, and booleans survive so
 * the operator can review what changes; string values are fingerprinted unless
 * their key is structural. Array elements inherit their parent key.
 *
 * Fingerprints prove that a value did or did not change between plans. They are
 * not a confidentiality boundary for low-entropy values, which stay guessable
 * by dictionary — the real control is never passing `--show-values`.
 */
export function redactRailwayPlan(value: JsonValue, key?: string): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => redactRailwayPlan(entry, key))
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, JsonValue>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((childKey) => [
          childKey,
          redactRailwayPlan(record[childKey] ?? null, childKey),
        ]),
    )
  }
  if (
    typeof value === 'string' &&
    !(key !== undefined && RAILWAY_PLAN_STRUCTURAL_KEYS.has(key))
  ) {
    return railwayPlanValueFingerprint(value)
  }
  return value
}

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

export function railwayPlanEvidenceSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function createRailwayPlanEvidence(
  input: Readonly<{
    capturedAt: Date
    cell: string
    target: Readonly<{ projectId: string; environment: string; environmentId: string }>
    iacSha256: string
    exitCode: number
    rawPlan: string
  }>,
): RailwayPlanEvidence {
  let parsedPlan: unknown
  try {
    parsedPlan = JSON.parse(input.rawPlan)
  } catch {
    throw new Error('Railway plan output is not valid JSON; rerun with --json')
  }
  return railwayPlanEvidenceSchema.parse({
    version: RAILWAY_PLAN_EVIDENCE_VERSION,
    evidenceKind: 'railway-data-cell-plan',
    capturedAt: input.capturedAt.toISOString(),
    cell: input.cell,
    target: input.target,
    iac: { sha256: input.iacSha256 },
    plan: {
      exitCode: input.exitCode,
      outcome: classifyRailwayPlanExit(input.exitCode),
      rawSha256: railwayPlanEvidenceSha256(input.rawPlan),
      redacted: redactRailwayPlan(parsedPlan as JsonValue),
    },
  })
}

export function canonicalRailwayPlanEvidence(value: RailwayPlanEvidence): string {
  return `${JSON.stringify(sortedJson(value as unknown as JsonValue))}\n`
}

export type RailwayPlanEvidenceParseResult =
  | Readonly<{ ok: true; evidence: RailwayPlanEvidence; digest: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parseRailwayPlanEvidence(
  content: string,
): RailwayPlanEvidenceParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['railway plan evidence is not valid JSON'] }
  }
  const parsed = railwayPlanEvidenceSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'evidence'}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalRailwayPlanEvidence(parsed.data)
  if (canonical !== content) {
    return {
      ok: false,
      errors: ['railway plan evidence must use canonical JSON encoding'],
    }
  }
  return {
    ok: true,
    evidence: Object.freeze(parsed.data),
    digest: railwayPlanEvidenceSha256(canonical),
  }
}
