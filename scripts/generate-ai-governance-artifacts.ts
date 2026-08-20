import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalizeRfc8785 } from '../src/shared/merchant-ai-notice-contract'
import { format, resolveConfig } from 'prettier'

const ROOT = resolve(import.meta.dirname, '..')
const POLICY_PATH = 'src/contexts/ai/domain/catalogues/ai-private-beta-policy-v1.json'
const OUTPUTS = {
  typed: 'src/contexts/ai/domain/catalogues/ai-private-beta-policy.generated.ts',
  migration: 'drizzle/generated/ai-private-beta-policy-v1.sql',
  documentation:
    'docs/product-readiness-program-2026-07/ai-governance/ai-private-beta-policy-v1.md',
  evidence:
    'docs/product-readiness-program-2026-07/ai-governance/ai-private-beta-policy-evidence-index.json',
  manifest: 'src/contexts/ai/domain/catalogues/ai-private-beta-policy-v1.manifest.json',
} as const

const SHA256 = /^[0-9a-f]{64}$/
const REQUIRED_CAPABILITIES = [
  'property_trends',
  'reply_drafting',
  'review_analysis',
] as const
const REQUIRED_TOP_LEVEL_KEYS = [
  'capabilities',
  'initialBundle',
  'manualPublicationRequired',
  'outputClasses',
  'region',
  'releaseGates',
  'retentionPolicies',
  'roles',
  'routes',
  'sourceClasses',
  'version',
] as const

type Row = Readonly<Record<string, unknown>>
type Policy = Readonly<{
  version: string
  region: string
  manualPublicationRequired: boolean
  initialBundle: readonly string[]
  capabilities: readonly Row[]
  roles: readonly Row[]
  routes: readonly Row[]
  sourceClasses: readonly Row[]
  outputClasses: readonly Row[]
  retentionPolicies: readonly Row[]
  releaseGates: readonly Row[]
}>

function fail(message: string): never {
  throw new TypeError(`Invalid AI private-beta policy: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Row, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} keys are not closed`)
  }
}

function closedRows(
  value: unknown,
  label: string,
  keys: readonly string[],
): readonly Row[] {
  if (!Array.isArray(value) || value.length === 0)
    fail(`${label} must be a non-empty array`)
  const rows = value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${label}[${index}] must be an object`)
    exactKeys(entry, keys, `${label}[${index}]`)
    if (typeof entry.id !== 'string' || entry.id.length === 0)
      fail(`${label}[${index}].id`)
    return Object.freeze(entry)
  })
  const ids = rows.map((row) => String(row.id))
  if (new Set(ids).size !== ids.length) fail(`${label} contains duplicate IDs`)
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
    fail(`${label} must be sorted by ID`)
  }
  return Object.freeze(rows)
}

function parsePolicy(value: unknown): Policy {
  if (!isRecord(value)) fail('root must be an object')
  exactKeys(value, REQUIRED_TOP_LEVEL_KEYS, 'root')
  if (value.version !== 'ai-private-beta-policy-v1') fail('version mismatch')
  if (value.region !== 'global') fail('region mismatch')
  if (value.manualPublicationRequired !== true)
    fail('manual publication must be required')
  if (
    !Array.isArray(value.initialBundle) ||
    canonicalizeRfc8785(value.initialBundle) !==
      canonicalizeRfc8785(REQUIRED_CAPABILITIES)
  ) {
    fail('initial bundle is missing, reordered, or cross-wired')
  }

  const capabilities = closedRows(value.capabilities, 'capabilities', [
    'actorKind',
    'id',
    'permission',
    'platformCapability',
    'requires',
    'routeId',
    'runtimeProfileVersion',
  ])
  const roles = closedRows(value.roles, 'roles', ['id', 'permissions'])
  const routes = closedRows(value.routes, 'routes', [
    'id',
    'outputClassId',
    'retentionPolicyId',
    'sourceClassId',
  ])
  const sourceClasses = closedRows(value.sourceClasses, 'sourceClasses', [
    'containsRawReviewContent',
    'id',
  ])
  const outputClasses = closedRows(value.outputClasses, 'outputClasses', [
    'durable',
    'id',
  ])
  const retentionPolicies = closedRows(value.retentionPolicies, 'retentionPolicies', [
    'duration',
    'id',
  ])
  const releaseGates = closedRows(value.releaseGates, 'releaseGates', [
    'contentClass',
    'id',
    'owner',
    'stage',
  ])

  const routeIds = new Set(routes.map((row) => row.id))
  const sourceIds = new Set(sourceClasses.map((row) => row.id))
  const outputIds = new Set(outputClasses.map((row) => row.id))
  const retentionIds = new Set(retentionPolicies.map((row) => row.id))
  const capabilityIds = new Set(capabilities.map((row) => row.id))
  for (const row of capabilities) {
    if (!routeIds.has(row.routeId))
      fail(`capability ${String(row.id)} references unknown route`)
    if (
      !Array.isArray(row.requires) ||
      row.requires.some((id) => !capabilityIds.has(id))
    ) {
      fail(`capability ${String(row.id)} has an invalid dependency`)
    }
  }
  for (const row of routes) {
    if (!sourceIds.has(row.sourceClassId))
      fail(`route ${String(row.id)} source reference`)
    if (!outputIds.has(row.outputClassId))
      fail(`route ${String(row.id)} output reference`)
    if (!retentionIds.has(row.retentionPolicyId))
      fail(`route ${String(row.id)} retention reference`)
  }

  return Object.freeze({
    version: value.version,
    region: value.region,
    manualPublicationRequired: value.manualPublicationRequired,
    initialBundle: Object.freeze([...value.initialBundle]),
    capabilities,
    roles,
    routes,
    sourceClasses,
    outputClasses,
    retentionPolicies,
    releaseGates,
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function markdownTable(rows: readonly Row[], columns: readonly string[]): string {
  const render = (value: unknown) =>
    Array.isArray(value) ? value.join(', ') || '—' : String(value)
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) => `| ${columns.map((column) => render(row[column])).join(' | ')} |`,
    ),
  ].join('\n')
}

const canonicalText = readFileSync(resolve(ROOT, POLICY_PATH), 'utf8')
const policy = parsePolicy(JSON.parse(canonicalText))
const canonicalBytes = canonicalizeRfc8785(policy)
const policyDigest = sha256(`ai-private-beta-policy-v1\0${canonicalBytes}`)
if (!SHA256.test(policyDigest)) fail('digest generation failed')

const rawProjections = {
  typed: `// Generated by scripts/generate-ai-governance-artifacts.ts. Do not edit.\n\nexport const AI_PRIVATE_BETA_POLICY_V1 = ${JSON.stringify(policy, null, 2)} as const\n\nexport const AI_PRIVATE_BETA_POLICY_V1_DIGEST = '${policyDigest}' as const\n`,
  migration: `-- Generated by scripts/generate-ai-governance-artifacts.ts. Do not edit.\nINSERT INTO "ai_governance_policies" ("version", "region", "manual_publication_required", "policy_digest", "canonical_policy", "created_at")\nVALUES ('${policy.version}', '${policy.region}', true, '${policyDigest}', '${canonicalBytes.replaceAll("'", "''")}'::jsonb, '2026-08-16T00:00:00Z');\n`,
  documentation: `# AI private-beta policy v1\n\nGenerated from \`${POLICY_PATH}\`. Digest: \`${policyDigest}\`.\n\n## Capabilities\n\n${markdownTable(policy.capabilities, ['id', 'platformCapability', 'permission', 'actorKind', 'routeId', 'runtimeProfileVersion', 'requires'])}\n\n## Routes\n\n${markdownTable(policy.routes, ['id', 'sourceClassId', 'outputClassId', 'retentionPolicyId'])}\n\n## Roles\n\n${markdownTable(policy.roles, ['id', 'permissions'])}\n\n## Release gates\n\n${markdownTable(policy.releaseGates, ['id', 'stage', 'owner', 'contentClass'])}\n`,
  evidence: `${JSON.stringify(
    {
      policyVersion: policy.version,
      policyDigest,
      contentClass: 'content_free',
      gates: policy.releaseGates.map(({ id, stage, owner, contentClass }) => ({
        id,
        stage,
        owner,
        contentClass,
      })),
    },
    null,
    2,
  )}\n`,
} as const

const prettierConfig = (await resolveConfig(resolve(ROOT, 'package.json'))) ?? {}
async function formatOutput(
  name: keyof typeof OUTPUTS,
  content: string,
): Promise<string> {
  if (name === 'migration') return content
  return format(content, {
    ...prettierConfig,
    filepath: resolve(ROOT, OUTPUTS[name]),
  })
}

const projections = {
  typed: await formatOutput('typed', rawProjections.typed),
  migration: rawProjections.migration,
  documentation: await formatOutput('documentation', rawProjections.documentation),
  evidence: await formatOutput('evidence', rawProjections.evidence),
} as const

const manifestMembers = Object.entries(projections).map(([name, content]) => ({
  name,
  path: OUTPUTS[name as keyof typeof projections],
  sha256: sha256(content),
  bytes: Buffer.byteLength(content, 'utf8'),
}))
const manifest = await formatOutput(
  'manifest',
  `${JSON.stringify(
    {
      version: 'ai-governance-artifacts-v1',
      source: POLICY_PATH,
      sourceCanonicalSha256: sha256(canonicalBytes),
      policyDigest,
      members: manifestMembers,
    },
    null,
    2,
  )}\n`,
)

const expected = { ...projections, manifest }
const check = process.argv.includes('--check')
const failures: string[] = []
for (const [name, content] of Object.entries(expected)) {
  const path = resolve(ROOT, OUTPUTS[name as keyof typeof OUTPUTS])
  if (check) {
    let current: string | null = null
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      // Report every missing member in one run.
    }
    if (current !== content) failures.push(OUTPUTS[name as keyof typeof OUTPUTS])
  } else {
    writeFileSync(path, content, 'utf8')
  }
}
if (failures.length > 0) {
  throw new Error(`AI governance artifacts drifted: ${failures.join(', ')}`)
}
