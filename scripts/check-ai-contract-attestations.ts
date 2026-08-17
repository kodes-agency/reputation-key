import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import process from 'node:process'
import { canonicalizeRfc8785 } from '../src/shared/merchant-ai-notice-contract'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from '../src/shared/ai-operation-profiles'

const ROOT = resolve(import.meta.dirname, '..')
const encoder = new TextEncoder()
const SHA256 = /^[0-9a-f]{64}$/u

export const AI_SOURCE_ATTESTATION_MEMBERS_V1 = Object.freeze([
  'src/shared/ai-review-source-contract.ts',
  'src/shared/ai-review-source-v1.vectors.json',
  'scripts/generate-ai-unicode-case-folding.ts',
  'vendor/unicode/17.0.0/CaseFolding.txt',
  'src/shared/generated/ai-unicode-case-folding-v17.ts',
] as const)

export const REVIEW_PROVIDER_SUBJECT_ATTESTATION_MEMBERS_V1 = Object.freeze([
  'src/shared/review-provider-subject-contract.ts',
  'src/shared/review-provider-subject-v1.vectors.json',
] as const)

const SOURCE_VECTOR_IDS = Object.freeze([
  'canonical-16383-bytes',
  'canonical-16384-bytes-multibyte',
  'canonical-16385-bytes-rejected',
  'combining-fold-after-nfkc',
  'empty-display-name',
  'empty-text',
  'expanding-fold-and-placeholder-escape',
  'generated-person-token-collision',
  'left-to-right-overlap',
  'null-text',
  'one-scalar-display-name',
  'raw-cap-65536-bytes',
  'raw-cap-65537-bytes-rejected',
  'raw-placeholder-collisions',
] as const)

const SUBJECT_VECTOR_IDS = Object.freeze([
  'base-domain-separated',
  'duplicate-both-hmac',
  'epoch-max-safe',
  'epoch-negative-rejected',
  'epoch-over-safe-rejected',
  'epoch-zero',
  'forced-locator-collision',
  'key-change',
  'key-length-31-rejected',
  'key-version-only',
  'key-version-uppercase-rejected',
  'organization-scope-change',
  'prefix-case-rejected',
  'property-scope-change',
  'resource-case-sensitive',
  'resource-percent-rejected',
  'segment-length-255',
  'segment-length-256-rejected',
  'uuid-uppercase-rejected',
] as const)

type JsonRecord = Readonly<Record<string, unknown>>

export type CanonicalizerAttestation = Readonly<{
  digest: string
  memberSha256: Readonly<Record<string, string>>
}>

export const SOURCE_CANONICALIZER_ATTESTATION_V1: CanonicalizerAttestation =
  Object.freeze({
    digest: 'df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5',
    memberSha256: Object.freeze({
      'src/shared/ai-review-source-contract.ts':
        '3df32496e212c118a16263f4f295d20ef9db27acb9811689aafe38fc7bfd87e9',
      'src/shared/ai-review-source-v1.vectors.json':
        '609243dd64d747b1573af13fe7cceec96669c2ee3ce3af43bc09dd08b4d695e8',
      'scripts/generate-ai-unicode-case-folding.ts':
        'cd6c546a95567119f8ffaf0987052b7bf714d240fc258072e8cb3a0d125081cb',
      'vendor/unicode/17.0.0/CaseFolding.txt':
        '84a8df1d87b5fde9b480d95769e0817416e3708b17fb473e4f1eac18eb7a8653',
      'src/shared/generated/ai-unicode-case-folding-v17.ts':
        '54aaedbf5993cc68cfc1a35721f668bde50f2b5be5f73b905e3def2c41509331',
    }),
  })

export const REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1: CanonicalizerAttestation =
  Object.freeze({
    digest: '9b6c7ff2467dcce05c1482a5b242b0f2925ead9d9be4b08340e374e1634a3ef6',
    memberSha256: Object.freeze({
      'src/shared/review-provider-subject-contract.ts':
        'a7b6d0db6635822cc88decae6ff3ed7a76357ca2625644d333fbd8366c50dde8',
      'src/shared/review-provider-subject-v1.vectors.json':
        '9b581ed9c44934aa53a2d5c329c1302a538034bb311a4676995c14908b086942',
    }),
  })

export const SOURCE_CANONICALIZER_DIGEST_V1 = SOURCE_CANONICALIZER_ATTESTATION_V1.digest
export const REVIEW_PROVIDER_SUBJECT_CANONICALIZER_DIGEST_V1 =
  REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1.digest

function fail(message: string): never {
  throw new Error(`AI canonicalizer attestation check failed: ${message}`)
}

function assertLfUtf8(bytes: Uint8Array, path: string): string {
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    fail(`${path} contains a UTF-8 BOM`)
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.includes('\r')) fail(`${path} contains a CR byte`)
  return text
}

function parseStrictJson(raw: string, path: string): unknown {
  let offset = 0

  const skipWhitespace = () => {
    while (offset < raw.length && /[\u0009\u000a\u000d\u0020]/u.test(raw[offset]!)) {
      offset += 1
    }
  }

  const scanString = (): string => {
    const start = offset
    if (raw[offset] !== '"') fail(`${path} contains malformed JSON`)
    offset += 1
    while (offset < raw.length) {
      const code = raw.charCodeAt(offset)
      if (code === 0x22) {
        offset += 1
        try {
          return JSON.parse(raw.slice(start, offset)) as string
        } catch {
          fail(`${path} contains malformed JSON string data`)
        }
      }
      if (code < 0x20) fail(`${path} contains an unescaped JSON control character`)
      if (code === 0x5c) {
        offset += 1
        const escape = raw[offset]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(raw.slice(offset + 1, offset + 5))) {
            fail(`${path} contains a malformed JSON Unicode escape`)
          }
          offset += 5
          continue
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          fail(`${path} contains a malformed JSON escape`)
        }
      }
      offset += 1
    }
    fail(`${path} contains an unterminated JSON string`)
  }

  const scanValue = (): void => {
    skipWhitespace()
    const token = raw[offset]
    if (token === '"') {
      scanString()
      return
    }
    if (token === '{') {
      offset += 1
      skipWhitespace()
      const keys = new Set<string>()
      if (raw[offset] === '}') {
        offset += 1
        return
      }
      while (offset < raw.length) {
        skipWhitespace()
        const key = scanString()
        if (keys.has(key))
          fail(`${path} contains duplicate object key ${JSON.stringify(key)}`)
        keys.add(key)
        skipWhitespace()
        if (raw[offset] !== ':') fail(`${path} contains malformed JSON object data`)
        offset += 1
        scanValue()
        skipWhitespace()
        if (raw[offset] === '}') {
          offset += 1
          return
        }
        if (raw[offset] !== ',') fail(`${path} contains malformed JSON object data`)
        offset += 1
      }
      fail(`${path} contains an unterminated JSON object`)
    }
    if (token === '[') {
      offset += 1
      skipWhitespace()
      if (raw[offset] === ']') {
        offset += 1
        return
      }
      while (offset < raw.length) {
        scanValue()
        skipWhitespace()
        if (raw[offset] === ']') {
          offset += 1
          return
        }
        if (raw[offset] !== ',') fail(`${path} contains malformed JSON array data`)
        offset += 1
      }
      fail(`${path} contains an unterminated JSON array`)
    }
    const remaining = raw.slice(offset)
    const literal = /^(?:true|false|null)/u.exec(remaining)?.[0]
    if (literal !== undefined) {
      offset += literal.length
      return
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      remaining,
    )?.[0]
    if (number !== undefined) {
      offset += number.length
      return
    }
    fail(`${path} contains malformed JSON value data`)
  }

  scanValue()
  skipWhitespace()
  if (offset !== raw.length) fail(`${path} contains trailing JSON data`)
  try {
    return JSON.parse(raw) as unknown
  } catch {
    fail(`${path} is not valid JSON`)
  }
}

function parseOrderedVectors(
  bytes: Uint8Array,
  path: string,
  expectedIds: readonly string[],
): readonly JsonRecord[] {
  const value = parseStrictJson(assertLfUtf8(bytes, path), path)
  if (!Array.isArray(value) || value.length !== expectedIds.length) {
    fail(`${path} must contain exactly ${expectedIds.length} vectors`)
  }
  const vectors: JsonRecord[] = []
  for (const [index, expectedId] of expectedIds.entries()) {
    const vector = value[index]
    if (vector === null || typeof vector !== 'object' || Array.isArray(vector)) {
      fail(`${path} vector ${index} must be an object`)
    }
    const record = vector as Record<string, unknown>
    if (record.vectorId !== expectedId) {
      fail(`${path} vector order drift at ${index}: expected ${expectedId}`)
    }
    vectors.push(Object.freeze({ ...record }))
  }
  return Object.freeze(vectors)
}

function uint32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    fail('length exceeds uint32')
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function encodeNonNullString(value: string): Uint8Array {
  const bytes = encoder.encode(value)
  const result = new Uint8Array(1 + 4 + bytes.byteLength)
  result[0] = 1
  result.set(uint32be(bytes.byteLength), 1)
  result.set(bytes, 5)
  return result
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(byteLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function encodeMember(path: string, bytes: Uint8Array): Uint8Array {
  return concatenate([encodeNonNullString(path), uint32be(bytes.byteLength), bytes])
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertSourceRuntimeImports(source: string): void {
  const imports = source.match(/^import[^\n]*$/gmu) ?? []
  const exactImport =
    "import { AI_UNICODE_CASE_FOLDING_V17 } from './generated/ai-unicode-case-folding-v17'"
  if (imports.length !== 1 || imports[0] !== exactImport) {
    fail(
      'ai-review-source-contract.ts must import only the exact generated case-fold table',
    )
  }
}

function assertNoRuntimeImports(source: string, path: string): void {
  if (/^\s*import(?:\s|\{)/mu.test(source))
    fail(`${path} must not contain a runtime import`)
}

function calculateAttestation(
  root: string,
  domain: string,
  members: readonly string[],
  vectorIdsByPath: Readonly<Record<string, readonly string[]>>,
): CanonicalizerAttestation {
  const encodedMembers: Uint8Array[] = []
  const memberSha256: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >
  for (const path of members) {
    const rawBytes = readFileSync(resolve(root, path))
    const rawText = assertLfUtf8(rawBytes, path)
    let memberBytes = new Uint8Array(
      rawBytes.buffer,
      rawBytes.byteOffset,
      rawBytes.byteLength,
    ).slice()
    const expectedIds = vectorIdsByPath[path]
    if (expectedIds !== undefined) {
      const vectors = parseOrderedVectors(memberBytes, path, expectedIds)
      memberBytes = encoder.encode(canonicalizeRfc8785(vectors))
    }
    if (path === 'src/shared/ai-review-source-contract.ts')
      assertSourceRuntimeImports(rawText)
    if (path === 'src/shared/generated/ai-unicode-case-folding-v17.ts') {
      assertNoRuntimeImports(rawText, path)
    }
    if (
      path === 'src/shared/review-provider-subject-contract.ts' &&
      /^\s*import\s+(?:[^\n]*\sfrom\s+)?['"]\./mu.test(rawText)
    ) {
      fail(`${path} must not contain a local runtime import`)
    }
    memberSha256[path] = sha256(memberBytes)
    encodedMembers.push(encodeMember(path, memberBytes))
  }
  const digestBytes = concatenate([
    encoder.encode(domain),
    uint32be(members.length),
    ...encodedMembers,
  ])
  return Object.freeze({
    digest: sha256(digestBytes),
    memberSha256: Object.freeze({ ...memberSha256 }),
  })
}

export function calculateSourceCanonicalizerAttestation(
  root: string = ROOT,
): CanonicalizerAttestation {
  return calculateAttestation(
    root,
    'repkey-ai-source-profile-v1\0',
    AI_SOURCE_ATTESTATION_MEMBERS_V1,
    { 'src/shared/ai-review-source-v1.vectors.json': SOURCE_VECTOR_IDS },
  )
}

export function calculateReviewProviderSubjectAttestation(
  root: string = ROOT,
): CanonicalizerAttestation {
  return calculateAttestation(
    root,
    'repkey-review-provider-subject-profile-v1\0',
    REVIEW_PROVIDER_SUBJECT_ATTESTATION_MEMBERS_V1,
    { 'src/shared/review-provider-subject-v1.vectors.json': SUBJECT_VECTOR_IDS },
  )
}

export function assertCanonicalizerAttestation(
  actual: CanonicalizerAttestation,
  expected: CanonicalizerAttestation,
  label: string,
): void {
  if (!SHA256.test(expected.digest)) {
    fail(`${label} has an invalid expected digest`)
  }
  const expectedPaths = Object.keys(expected.memberSha256)
  const actualPaths = Object.keys(actual.memberSha256)
  if (canonicalizeRfc8785(actualPaths) !== canonicalizeRfc8785(expectedPaths)) {
    fail(`${label} member path mismatch`)
  }
  for (const path of expectedPaths) {
    const expectedDigest = expected.memberSha256[path]
    if (expectedDigest === undefined || !SHA256.test(expectedDigest)) {
      fail(`${label} has an invalid expected member digest for ${path}`)
    }
    if (actual.memberSha256[path] !== expectedDigest) {
      fail(`${label} member digest mismatch for ${path}: ${actual.memberSha256[path]}`)
    }
  }
  if (actual.digest !== expected.digest) {
    fail(`${label} digest mismatch: ${actual.digest}`)
  }
}

function digestCanonical(domain: string, value: unknown): string {
  const hash = createHash('sha256')
  hash.update(domain, 'utf8')
  hash.update(canonicalizeRfc8785(value), 'utf8')
  return hash.digest('hex')
}

function assertOperationProfileDigests(): void {
  const { profileDigest: providerDigest, ...providerContract } =
    AI_PROVIDER_DEPLOYMENT_PROFILE
  if (
    providerDigest !==
    digestCanonical('repkey-ai-provider-deployment-profile-v1\0', providerContract)
  ) {
    fail('provider deployment profile digest mismatch')
  }
  const { policyDigest, ...routingContract } = AI_ROUTING_POLICY
  if (
    policyDigest !== digestCanonical('repkey-ai-routing-policy-v1\0', routingContract)
  ) {
    fail('routing policy digest mismatch')
  }

  for (const profile of AI_OPERATION_PROFILES) {
    const schemaDigest = digestCanonical(
      'repkey-ai-output-schema-v1\0',
      profile.outputSchema,
    )
    const promptDigest = digestCanonical(
      'repkey-ai-developer-prompt-v1\0',
      profile.developerPrompt,
    )
    const {
      profileDigest,
      outputSchema: _outputSchema,
      developerPrompt: _developerPrompt,
      ...persisted
    } = profile
    const actual = digestCanonical('repkey-ai-operation-profile-v1\0', persisted)
    if (schemaDigest !== profile.outputSchemaDigest) {
      fail(`output schema digest mismatch for ${profile.profileVersion}: ${schemaDigest}`)
    }
    if (promptDigest !== profile.promptDigest) {
      fail(
        `developer prompt digest mismatch for ${profile.profileVersion}: ${promptDigest}`,
      )
    }
    if (!SHA256.test(profileDigest) || actual !== profileDigest) {
      fail(`operation profile digest mismatch for ${profile.profileVersion}: ${actual}`)
    }
  }
}

export function checkCanonicalizerAttestations(root: string = ROOT): Readonly<{
  sourceCanonicalizerDigest: string
  reviewProviderSubjectCanonicalizerDigest: string
}> {
  const source = calculateSourceCanonicalizerAttestation(root)
  const subject = calculateReviewProviderSubjectAttestation(root)
  assertCanonicalizerAttestation(source, SOURCE_CANONICALIZER_ATTESTATION_V1, 'source')
  assertCanonicalizerAttestation(
    subject,
    REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1,
    'provider subject',
  )
  assertOperationProfileDigests()
  return Object.freeze({
    sourceCanonicalizerDigest: source.digest,
    reviewProviderSubjectCanonicalizerDigest: subject.digest,
  })
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1])
if (invokedPath !== null && fileURLToPath(import.meta.url) === invokedPath) {
  const result = checkCanonicalizerAttestations()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
