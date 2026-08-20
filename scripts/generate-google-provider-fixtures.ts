import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { format, resolveConfig } from 'prettier'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOGUE_PATH = 'test-fixtures/google-provider-identifiers-v1.json'
const CATALOGUE_VERSION = 'google-provider-identifiers-v1'
const UNIT_TARGET = 'test-fixtures/generated/google-provider-identifiers-v1.ts'
const E2E_TARGET = 'e2e/fixtures/generated/google-provider-identifiers-v1.ts'
const UNIT_REEXPORT_TARGET =
  'src/test-fixtures/generated/google-provider-identifiers-v1.ts'
const SUBJECT_TARGET = 'test-fixtures/generated/review-provider-subject-v1.fixture.json'
const DOC_TARGETS = [
  'docs/adr/0031-google-source-content-and-ai-processing-boundary.md',
  'docs/operations/runbooks.md',
  'docs/product-readiness-program-2026-07/ai-governance/source-content-policy-specification.md',
] as const
const SUPPORTED_TARGETS: Readonly<Record<string, true>> = Object.freeze({
  [UNIT_TARGET]: true,
  [E2E_TARGET]: true,
  [UNIT_REEXPORT_TARGET]: true,
  [SUBJECT_TARGET]: true,
  [DOC_TARGETS[0]]: true,
  [DOC_TARGETS[1]]: true,
  [DOC_TARGETS[2]]: true,
})
const ANCHOR_START = '<!-- google-provider-identifiers-v1:start -->'
const ANCHOR_END = '<!-- google-provider-identifiers-v1:end -->'
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,254}$/u
const EXACT_KEYS = Object.freeze({
  catalogue: ['catalogueVersion', 'entries'],
  entry: [
    'fixtureId',
    'kind',
    'literal',
    'valid',
    'expectedSegments',
    'allowedGeneratedTargets',
  ],
  segments: ['accountId', 'locationId', 'reviewId'],
})

type FixtureKind = 'account' | 'location' | 'review'
type ExpectedSegments = Readonly<{
  accountId: string
  locationId: string | null
  reviewId: string | null
}>
type FixtureEntry = Readonly<{
  fixtureId: string
  kind: FixtureKind
  literal: string
  valid: boolean
  expectedSegments: ExpectedSegments | null
  allowedGeneratedTargets: readonly string[]
}>
type FixtureCatalogue = Readonly<{
  catalogueVersion: typeof CATALOGUE_VERSION
  entries: readonly FixtureEntry[]
}>

class StrictJsonReader {
  readonly #source: string
  #offset = 0

  constructor(source: string) {
    this.#source = source
  }

  parse(): unknown {
    const value = this.#parseValue()
    this.#skipWhitespace()
    if (this.#offset !== this.#source.length)
      throw new Error('catalogue has trailing JSON data')
    return value
  }

  #parseValue(): unknown {
    this.#skipWhitespace()
    const current = this.#source[this.#offset]
    if (current === '{') return this.#parseObject()
    if (current === '[') return this.#parseArray()
    if (current === '"') return this.#parseString()
    for (const [token, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.#source.startsWith(token, this.#offset)) {
        this.#offset += token.length
        return value
      }
    }
    const match = this.#source
      .slice(this.#offset)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)
    if (!match) throw new Error(`invalid JSON at byte ${this.#offset}`)
    this.#offset += match[0].length
    const number = Number(match[0])
    if (!Number.isFinite(number))
      throw new Error('catalogue contains a non-finite number')
    return number
  }

  #parseObject(): Record<string, unknown> {
    this.#offset += 1
    const result: Record<string, unknown> = Object.create(null)
    const keys = new Set<string>()
    this.#skipWhitespace()
    if (this.#source[this.#offset] === '}') {
      this.#offset += 1
      return result
    }
    for (;;) {
      this.#skipWhitespace()
      if (this.#source[this.#offset] !== '"')
        throw new Error('JSON object key must be a string')
      const key = this.#parseString()
      if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`)
      keys.add(key)
      this.#skipWhitespace()
      if (this.#source[this.#offset] !== ':')
        throw new Error(`missing colon after JSON key: ${key}`)
      this.#offset += 1
      result[key] = this.#parseValue()
      this.#skipWhitespace()
      const delimiter = this.#source[this.#offset]
      this.#offset += 1
      if (delimiter === '}') return result
      if (delimiter !== ',')
        throw new Error('JSON object entries must be comma-separated')
    }
  }

  #parseArray(): unknown[] {
    this.#offset += 1
    const result: unknown[] = []
    this.#skipWhitespace()
    if (this.#source[this.#offset] === ']') {
      this.#offset += 1
      return result
    }
    for (;;) {
      result.push(this.#parseValue())
      this.#skipWhitespace()
      const delimiter = this.#source[this.#offset]
      this.#offset += 1
      if (delimiter === ']') return result
      if (delimiter !== ',') throw new Error('JSON array entries must be comma-separated')
    }
  }

  #parseString(): string {
    const start = this.#offset
    this.#offset += 1
    while (this.#offset < this.#source.length) {
      const scalar = this.#source[this.#offset]
      if (scalar === '"') {
        this.#offset += 1
        return JSON.parse(this.#source.slice(start, this.#offset)) as string
      }
      if (scalar === '\\') this.#offset += 1
      this.#offset += 1
    }
    throw new Error('unterminated JSON string')
  }

  #skipWhitespace(): void {
    while (/\s/u.test(this.#source[this.#offset] ?? '')) this.#offset += 1
  }
}

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${label} keys must be exactly ordered as ${keys.join(', ')}`)
  }
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && values[index - 1]! >= values[index]!) {
      throw new Error(`${label} must be sorted and unique`)
    }
  }
}

function parseResource(
  literal: string,
): { kind: FixtureKind; segments: ExpectedSegments } | null {
  if (Buffer.byteLength(literal, 'utf8') > 1_024 || !literal.startsWith('accounts/'))
    return null
  const parts = literal.split('/')
  if (parts.length === 2 && parts[0] === 'accounts' && SEGMENT.test(parts[1]!)) {
    return {
      kind: 'account',
      segments: { accountId: parts[1]!, locationId: null, reviewId: null },
    }
  }
  if (
    parts.length === 4 &&
    parts[0] === 'accounts' &&
    SEGMENT.test(parts[1]!) &&
    parts[2] === 'locations' &&
    SEGMENT.test(parts[3]!)
  ) {
    return {
      kind: 'location',
      segments: { accountId: parts[1]!, locationId: parts[3]!, reviewId: null },
    }
  }
  if (
    parts.length === 6 &&
    parts[0] === 'accounts' &&
    SEGMENT.test(parts[1]!) &&
    parts[2] === 'locations' &&
    SEGMENT.test(parts[3]!) &&
    parts[4] === 'reviews' &&
    SEGMENT.test(parts[5]!)
  ) {
    return {
      kind: 'review',
      segments: { accountId: parts[1]!, locationId: parts[3]!, reviewId: parts[5]! },
    }
  }
  return null
}

function parseExpectedSegments(value: unknown, label: string): ExpectedSegments | null {
  if (value === null) return null
  assertPlainObject(value, label)
  assertExactKeys(value, EXACT_KEYS.segments, label)
  if (typeof value.accountId !== 'string' || !SEGMENT.test(value.accountId)) {
    throw new Error(`${label}.accountId is invalid`)
  }
  for (const key of ['locationId', 'reviewId'] as const) {
    if (
      value[key] !== null &&
      (typeof value[key] !== 'string' || !SEGMENT.test(value[key]))
    ) {
      throw new Error(`${label}.${key} is invalid`)
    }
  }
  return {
    accountId: value.accountId,
    locationId: value.locationId as string | null,
    reviewId: value.reviewId as string | null,
  }
}

export function parseGoogleProviderFixtureCatalogue(source: string): FixtureCatalogue {
  if (source.startsWith('\uFEFF')) throw new Error('catalogue must not contain a BOM')
  if (source.includes('\r')) throw new Error('catalogue must use LF line endings')
  if (!source.endsWith('\n')) throw new Error('catalogue must end with LF')
  const raw = new StrictJsonReader(source).parse()
  assertPlainObject(raw, 'catalogue')
  assertExactKeys(raw, EXACT_KEYS.catalogue, 'catalogue')
  if (raw.catalogueVersion !== CATALOGUE_VERSION)
    throw new Error('catalogueVersion is not supported')
  if (!Array.isArray(raw.entries) || raw.entries.length === 0)
    throw new Error('entries must be non-empty')

  const entries = raw.entries.map((rawEntry, index): FixtureEntry => {
    const label = `entries[${index}]`
    assertPlainObject(rawEntry, label)
    assertExactKeys(rawEntry, EXACT_KEYS.entry, label)
    if (
      typeof rawEntry.fixtureId !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/u.test(rawEntry.fixtureId)
    ) {
      throw new Error(`${label}.fixtureId is invalid`)
    }
    if (
      rawEntry.kind !== 'account' &&
      rawEntry.kind !== 'location' &&
      rawEntry.kind !== 'review'
    ) {
      throw new Error(`${label}.kind is invalid`)
    }
    if (typeof rawEntry.literal !== 'string' || typeof rawEntry.valid !== 'boolean') {
      throw new Error(`${label} literal/valid fields are invalid`)
    }
    const expectedSegments = parseExpectedSegments(
      rawEntry.expectedSegments,
      `${label}.expectedSegments`,
    )
    if (
      !Array.isArray(rawEntry.allowedGeneratedTargets) ||
      rawEntry.allowedGeneratedTargets.some((target) => typeof target !== 'string')
    ) {
      throw new Error(`${label}.allowedGeneratedTargets is invalid`)
    }
    const allowedGeneratedTargets = rawEntry.allowedGeneratedTargets as string[]
    assertSortedUnique(allowedGeneratedTargets, `${label}.allowedGeneratedTargets`)
    if (allowedGeneratedTargets.some((target) => SUPPORTED_TARGETS[target] !== true)) {
      throw new Error(`${label} names an unsupported generated target`)
    }
    const expectedTargets = [
      ...(rawEntry.valid ? [E2E_TARGET] : []),
      ...(rawEntry.fixtureId === 'google-review-primary'
        ? [...DOC_TARGETS, SUBJECT_TARGET]
        : []),
      UNIT_TARGET,
    ].sort()
    if (
      allowedGeneratedTargets.length !== expectedTargets.length ||
      allowedGeneratedTargets.some(
        (target, targetIndex) => target !== expectedTargets[targetIndex],
      )
    ) {
      throw new Error(
        `${label}.allowedGeneratedTargets do not match its generated consumers`,
      )
    }

    const parsed = parseResource(rawEntry.literal)
    if (rawEntry.valid) {
      if (!parsed || parsed.kind !== rawEntry.kind || expectedSegments === null) {
        throw new Error(`${label} valid resource does not match its kind/segments`)
      }
      if (JSON.stringify(parsed.segments) !== JSON.stringify(expectedSegments)) {
        throw new Error(`${label} expectedSegments do not match the literal`)
      }
    } else if (parsed !== null || expectedSegments !== null) {
      throw new Error(
        `${label} invalid vector must fail grammar and have null expectedSegments`,
      )
    }

    return Object.freeze({
      fixtureId: rawEntry.fixtureId,
      kind: rawEntry.kind,
      literal: rawEntry.literal,
      valid: rawEntry.valid,
      expectedSegments,
      allowedGeneratedTargets: Object.freeze([...allowedGeneratedTargets]),
    })
  })

  assertSortedUnique(
    entries.map((entry) => entry.fixtureId),
    'fixture IDs',
  )
  const literals = entries.map((entry) => entry.literal)
  if (new Set(literals).size !== literals.length)
    throw new Error('fixture literals must be unique')
  const primary = entries.find((entry) => entry.fixtureId === 'google-review-primary')
  if (
    !primary?.valid ||
    primary.kind !== 'review' ||
    !primary.literal.includes('repkey-synthetic-do-not-use-')
  ) {
    throw new Error(
      'google-review-primary must be an unmistakably synthetic valid review resource',
    )
  }

  return Object.freeze({
    catalogueVersion: CATALOGUE_VERSION,
    entries: Object.freeze(entries),
  })
}

function quote(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}'`
}

function renderExpectedSegments(segments: ExpectedSegments | null): string {
  if (segments === null) return 'null'
  return `Object.freeze({
      accountId: ${quote(segments.accountId)},
      locationId: ${segments.locationId === null ? 'null' : quote(segments.locationId)},
      reviewId: ${segments.reviewId === null ? 'null' : quote(segments.reviewId)},
    })`
}

function renderUnitModule(catalogue: FixtureCatalogue, digest: string): string {
  const entries = catalogue.entries
    .map(
      (entry) => `  ${quote(entry.fixtureId)}: Object.freeze({
    kind: ${quote(entry.kind)},
    literal:
      ${quote(entry.literal)},
    valid: ${entry.valid},
    expectedSegments: ${renderExpectedSegments(entry.expectedSegments)},
  }),`,
    )
    .join('\n')
  return `// Generated by scripts/generate-google-provider-fixtures.ts. Do not edit.
// Catalogue: ${catalogue.catalogueVersion} sha256:${digest}

export const GOOGLE_PROVIDER_FIXTURE_CATALOGUE_VERSION_V1 = ${quote(catalogue.catalogueVersion)}
export const GOOGLE_PROVIDER_FIXTURE_CATALOGUE_SHA256_V1 =
  ${quote(digest)}

export const GOOGLE_PROVIDER_FIXTURES_V1 = Object.freeze({
${entries}
} as const)

export const GOOGLE_ACCOUNT_PRIMARY_RESOURCE =
  GOOGLE_PROVIDER_FIXTURES_V1['google-account-primary'].literal
export const GOOGLE_LOCATION_PRIMARY_RESOURCE =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].literal
export const GOOGLE_REVIEW_PRIMARY_RESOURCE =
  GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].literal
export const GOOGLE_REVIEW_PRIMARY_SEGMENTS =
  GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments
`
}

function renderUnitReexportModule(catalogue: FixtureCatalogue, digest: string): string {
  return `// Generated by scripts/generate-google-provider-fixtures.ts. Do not edit.
// Catalogue: ${catalogue.catalogueVersion} sha256:${digest}

export * from '../../../test-fixtures/generated/google-provider-identifiers-v1'
`
}

function renderE2eModule(catalogue: FixtureCatalogue, digest: string): string {
  const validEntries = catalogue.entries.filter((entry) => entry.valid)
  const resourceRows = validEntries
    .map(
      (entry) => `  Object.freeze({
    fixtureId: ${quote(entry.fixtureId)},
    kind: ${quote(entry.kind)},
    name:
      ${quote(entry.literal)},
  }),`,
    )
    .join('\n')
  const review = validEntries.find((entry) => entry.kind === 'review')
  if (!review?.expectedSegments?.locationId || !review.expectedSegments.reviewId) {
    throw new Error('E2E output requires one valid review entry')
  }
  return `// Generated by scripts/generate-google-provider-fixtures.ts. Do not edit.\n// Catalogue: ${catalogue.catalogueVersion} sha256:${digest}\n\nexport const GOOGLE_E2E_PROVIDER_RESOURCES_V1 = Object.freeze([\n${resourceRows}\n])\n\nexport const GOOGLE_E2E_STUB_REVIEW_ROWS_V1 = Object.freeze([\n  Object.freeze({\n    fixtureId: ${quote(review.fixtureId)},\n    name: ${quote(review.literal)},\n    accountId: ${quote(review.expectedSegments.accountId)},\n    locationId: ${quote(review.expectedSegments.locationId)},\n    reviewId: ${quote(review.expectedSegments.reviewId)},\n    starRating: 'FIVE',\n    comment: 'Synthetic fixture review. Do not use with a real provider.',\n    reviewer: Object.freeze({ displayName: 'Synthetic Fixture Guest' }),\n  }),\n])\n`
}

function renderSubjectFixture(catalogue: FixtureCatalogue, digest: string): string {
  const entry = catalogue.entries.find(
    (candidate) => candidate.fixtureId === 'google-review-primary',
  )
  if (!entry?.expectedSegments)
    throw new Error('provider-subject output requires google-review-primary')
  return `${JSON.stringify(
    {
      catalogueVersion: catalogue.catalogueVersion,
      catalogueSha256: digest,
      fixtureId: entry.fixtureId,
      resourceName: entry.literal,
      expectedSegments: entry.expectedSegments,
    },
    null,
    2,
  )}\n`
}

function renderDocBlock(catalogue: FixtureCatalogue, digest: string): string {
  const entry = catalogue.entries.find(
    (candidate) => candidate.fixtureId === 'google-review-primary',
  )
  if (!entry) throw new Error('documentation output requires google-review-primary')
  return `${ANCHOR_START}\n> Generated from \`${CATALOGUE_PATH}\` (${catalogue.catalogueVersion}, SHA-256 \`${digest}\`). Do not edit this block.\n> Canonical synthetic review resource: \`${entry.literal}\`.\n${ANCHOR_END}`
}

export function replaceGoogleProviderFixtureAnchor(
  document: string,
  block: string,
  path: string,
): string {
  const startMatches = document.split(ANCHOR_START).length - 1
  const endMatches = document.split(ANCHOR_END).length - 1
  if (startMatches !== 1 || endMatches !== 1) {
    throw new Error(
      `${path} must contain exactly one complete Google provider fixture anchor`,
    )
  }
  const start = document.indexOf(ANCHOR_START)
  const end = document.indexOf(ANCHOR_END, start)
  if (end < start) throw new Error(`${path} has reversed Google provider fixture anchors`)
  return `${document.slice(0, start)}${block}${document.slice(end + ANCHOR_END.length)}`
}

function validateTargetUsage(catalogue: FixtureCatalogue): void {
  for (const entry of catalogue.entries) {
    const expected = new Set<string>([UNIT_TARGET])
    if (entry.valid) expected.add(E2E_TARGET)
    if (entry.fixtureId === 'google-review-primary') {
      expected.add(SUBJECT_TARGET)
      for (const path of DOC_TARGETS) expected.add(path)
    }
    const actual = new Set(entry.allowedGeneratedTargets)
    if (
      expected.size !== actual.size ||
      [...expected].some((target) => !actual.has(target))
    ) {
      throw new Error(
        `${entry.fixtureId} allowedGeneratedTargets do not match generator usage`,
      )
    }
  }
}

export function validateGoogleProviderFixtureCatalogueSource(
  source: string,
): FixtureCatalogue {
  const catalogue = parseGoogleProviderFixtureCatalogue(source)
  validateTargetUsage(catalogue)
  return catalogue
}

async function buildExpectedOutputs(
  catalogueSource: string,
): Promise<Map<string, string>> {
  const catalogue = validateGoogleProviderFixtureCatalogueSource(catalogueSource)
  const digest = createHash('sha256').update(catalogueSource, 'utf8').digest('hex')
  const outputs = new Map<string, string>([
    [UNIT_TARGET, renderUnitModule(catalogue, digest)],
    [UNIT_REEXPORT_TARGET, renderUnitReexportModule(catalogue, digest)],
    [E2E_TARGET, renderE2eModule(catalogue, digest)],
    [SUBJECT_TARGET, renderSubjectFixture(catalogue, digest)],
  ])
  const block = renderDocBlock(catalogue, digest)
  for (const path of DOC_TARGETS) {
    const document = await readFile(resolve(ROOT, path), 'utf8')
    outputs.set(path, replaceGoogleProviderFixtureAnchor(document, block, path))
  }
  const prettierConfig = (await resolveConfig(resolve(ROOT, 'package.json'))) ?? {}
  await Promise.all(
    [...outputs].map(async ([path, source]) => {
      outputs.set(
        path,
        await format(source, {
          ...prettierConfig,
          filepath: resolve(ROOT, path),
        }),
      )
    }),
  )
  return outputs
}

export async function generateGoogleProviderFixtures(
  options: Readonly<{ check: boolean }>,
): Promise<void> {
  const catalogueSource = await readFile(resolve(ROOT, CATALOGUE_PATH), 'utf8')
  const outputs = await buildExpectedOutputs(catalogueSource)
  const stale: string[] = []
  for (const [path, expected] of outputs) {
    const absolutePath = resolve(ROOT, path)
    if (options.check) {
      const actual = await readFile(absolutePath, 'utf8').catch(() => null)
      if (actual !== expected) stale.push(path)
      continue
    }
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, expected, 'utf8')
  }
  if (stale.length > 0) {
    throw new Error(
      `stale Google provider fixture outputs:\n${stale.map((path) => `- ${path}`).join('\n')}`,
    )
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--check'))
    throw new Error('usage: generate-google-provider-fixtures.ts [--check]')
  await generateGoogleProviderFixtures({ check: args.includes('--check') })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
