import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  ORGANIZATION_LIFECYCLE_CONTEXTS,
  validateLifecycleEvidenceRef,
} from '../domain/organization-lifecycle'
// The contributor half of this contract lives in ports/ so that foreign
// contexts' infrastructure/adapters/** may legally implement it — see the header
// of organization-export-contributor.port.ts. Re-exported here so Identity's own
// callers keep importing one Organization Export vocabulary.
import {
  CLASSIFICATIONS_BY_CONTEXT,
  ORGANIZATION_EXPORT_CLASSIFICATIONS,
  type OrganizationExportClassification,
  type OrganizationExportContribution,
  type OrganizationExportContributor,
  type OrganizationExportEntry,
} from './ports/organization-export-contributor.port'

export {
  CLASSIFICATIONS_BY_CONTEXT,
  ORGANIZATION_EXPORT_CLASSIFICATIONS,
  type OrganizationExportClassification,
  type OrganizationExportContribution,
  type OrganizationExportContributor,
  type OrganizationExportEntry,
}

export const ORGANIZATION_EXPORT_FORMAT_VERSION = 'organization-export/v1' as const
export const ORGANIZATION_EXPORT_LINK_TTL_MS = 24 * 60 * 60 * 1000
export const ORGANIZATION_EXPORT_OBJECT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type OrganizationExportManifestEntry = Readonly<{
  path: string
  mediaType: OrganizationExportEntry['mediaType']
  classification: OrganizationExportClassification
  sizeBytes: number
  sha256: string
}>

export type OrganizationExportBundle = Readonly<{
  version: typeof ORGANIZATION_EXPORT_FORMAT_VERSION
  asOf: Date
  coverageSha256: string
  manifestSha256: string
  entries: readonly OrganizationExportEntry[]
  manifest: Readonly<{
    version: typeof ORGANIZATION_EXPORT_FORMAT_VERSION
    asOf: string
    entries: readonly OrganizationExportManifestEntry[]
  }>
}>

const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,199}$/
const FORBIDDEN_PATH_COMPONENT =
  /(?:^|[/_.-])(?:oauth|secrets?|sessions?|cookies?|passwords?|hash(?:es)?|credentials?|tokens?|keys?|queues?|outbox(?:es)?|receipts?|rate.?limits?|fraud|security|prompts?|inferences?|operational.?actions?)(?=$|[/_.-])/iu

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

function validateEntryEncoding(entry: OrganizationExportEntry): void {
  let text: string
  try {
    text = UTF8_DECODER.decode(entry.bytes)
  } catch {
    throw new Error(`Organization Export entry is not valid UTF-8: ${entry.path}`)
  }
  if (entry.mediaType === 'application/json') {
    try {
      JSON.parse(text)
    } catch {
      throw new Error(`Organization Export entry contains invalid JSON: ${entry.path}`)
    }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Canonical ZIP/manifest order is UTF-8 byte order, never host locale order. */
export function compareOrganizationExportPath(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function jsonEntry(path: string, value: unknown): OrganizationExportEntry {
  return {
    path,
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(value)}\n`, 'utf8'),
  }
}

function readmeEntry(asOf: Date): OrganizationExportEntry {
  return {
    path: 'README.md',
    mediaType: 'text/markdown',
    classification: 'tenant_visible',
    bytes: Buffer.from(
      [
        '# RepKey Organization Export',
        '',
        `Format: ${ORGANIZATION_EXPORT_FORMAT_VERSION}`,
        `As of: ${asOf.toISOString()}`,
        '',
        'CSV files are human-readable views. JSON files are the lossless export authority.',
        'coverage.json records complete, empty, and intentionally omitted context contributions.',
        'manifest.json binds every other file by SHA-256.',
        '',
      ].join('\n'),
      'utf8',
    ),
  }
}

function assertContributorSet(contributors: readonly OrganizationExportContributor[]) {
  const ids = contributors.map((contributor) => contributor.context)
  const missing = ORGANIZATION_LIFECYCLE_CONTEXTS.filter(
    (context) => !ids.includes(context),
  )
  if (
    new Set(ids).size !== ids.length ||
    missing.length > 0 ||
    ids.length !== ORGANIZATION_LIFECYCLE_CONTEXTS.length
  ) {
    throw new Error(
      `Organization Export contributors are incomplete: ${missing.join(',')}`,
    )
  }
}

function validateContribution(
  contribution: OrganizationExportContribution,
): OrganizationExportContribution {
  const { context } = contribution
  if (contribution.coverage === 'complete' && contribution.entries.length === 0) {
    throw new Error(`Complete Organization Export contribution is empty: ${context}`)
  }
  if (contribution.coverage !== 'complete' && contribution.entries.length > 0) {
    throw new Error(
      `Non-complete Organization Export contribution has entries: ${context}`,
    )
  }
  if (contribution.coverage === 'omitted' && contribution.omissionCodes.length === 0) {
    throw new Error(`Omitted Organization Export contribution has no reason: ${context}`)
  }
  if (contribution.coverage !== 'omitted' && contribution.omissionCodes.length > 0) {
    throw new Error(`Organization Export omission reason is not applicable: ${context}`)
  }
  for (const code of contribution.omissionCodes) validateLifecycleEvidenceRef(code)

  const formats = new Set<string>()
  for (const entry of contribution.entries) {
    if (
      !SAFE_PATH.test(entry.path) ||
      !entry.path.startsWith(`${context}/`) ||
      entry.path.includes('..') ||
      FORBIDDEN_PATH_COMPONENT.test(entry.path)
    ) {
      throw new Error(`Unsafe Organization Export path: ${entry.path}`)
    }
    if (!CLASSIFICATIONS_BY_CONTEXT[context].includes(entry.classification)) {
      throw new Error(
        `Organization Export classification is not permitted for ${context}`,
      )
    }
    if (entry.bytes.byteLength === 0) {
      throw new Error(`Organization Export entry is empty: ${entry.path}`)
    }
    validateEntryEncoding(entry)
    formats.add(entry.mediaType)
  }
  if (
    contribution.coverage === 'complete' &&
    (!formats.has('text/csv') || !formats.has('application/json'))
  ) {
    throw new Error(`Organization Export contribution needs CSV and JSON: ${context}`)
  }
  return contribution
}

export async function buildOrganizationExportBundle(input: {
  organizationId: string
  requestId: string
  asOf: Date
  contributors: readonly OrganizationExportContributor[]
}): Promise<OrganizationExportBundle> {
  if (Number.isNaN(input.asOf.getTime())) throw new Error('Export asOf must be valid')
  assertContributorSet(input.contributors)
  const byContext = new Map(
    input.contributors.map((contributor) => [contributor.context, contributor]),
  )
  const contributions = await Promise.all(
    ORGANIZATION_LIFECYCLE_CONTEXTS.map(async (context) => {
      const contribution = await byContext.get(context)!.contribute({
        organizationId: input.organizationId,
        requestId: input.requestId,
        asOf: input.asOf,
      })
      if (contribution.context !== context) {
        throw new Error(`Organization Export contributor identity changed: ${context}`)
      }
      return validateContribution(contribution)
    }),
  )

  const paths = new Set<string>()
  const contextEntries = contributions
    .flatMap((contribution) => contribution.entries)
    .sort((left, right) => compareOrganizationExportPath(left.path, right.path))
  for (const entry of contextEntries) {
    if (paths.has(entry.path))
      throw new Error(`Duplicate Organization Export path: ${entry.path}`)
    paths.add(entry.path)
  }

  const coverage = {
    version: ORGANIZATION_EXPORT_FORMAT_VERSION,
    asOf: input.asOf.toISOString(),
    contexts: contributions.map(({ context, coverage, omissionCodes, entries }) => ({
      context,
      coverage,
      omissionCodes,
      entryCount: entries.length,
    })),
  }
  const schema = {
    version: ORGANIZATION_EXPORT_FORMAT_VERSION,
    fileAuthority: { csv: 'human_readable', json: 'lossless' },
    classifications: ORGANIZATION_EXPORT_CLASSIFICATIONS,
  }
  const baseEntries = [
    readmeEntry(input.asOf),
    jsonEntry('coverage.json', coverage),
    jsonEntry('schema.json', schema),
    ...contextEntries,
  ]
  const manifestEntries = baseEntries.map((entry) => ({
    path: entry.path,
    mediaType: entry.mediaType,
    classification: entry.classification,
    sizeBytes: entry.bytes.byteLength,
    sha256: sha256(entry.bytes),
  }))
  const manifest = {
    version: ORGANIZATION_EXPORT_FORMAT_VERSION,
    asOf: input.asOf.toISOString(),
    entries: manifestEntries,
  } as const
  const manifestEntry = jsonEntry('manifest.json', manifest)
  return {
    version: ORGANIZATION_EXPORT_FORMAT_VERSION,
    asOf: input.asOf,
    coverageSha256: manifestEntries.find((entry) => entry.path === 'coverage.json')!
      .sha256,
    manifestSha256: sha256(manifestEntry.bytes),
    entries: [...baseEntries, manifestEntry],
    manifest,
  }
}
