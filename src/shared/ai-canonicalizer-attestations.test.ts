import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_SOURCE_ATTESTATION_MEMBERS_V1,
  REVIEW_PROVIDER_SUBJECT_ATTESTATION_MEMBERS_V1,
  REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1,
  SOURCE_CANONICALIZER_ATTESTATION_V1,
  assertPinnedProviderDependencyVersions,
  assertCanonicalizerAttestation,
  calculateReviewProviderSubjectAttestation,
  calculateSourceCanonicalizerAttestation,
  checkCanonicalizerAttestations,
} from '../../scripts/check-ai-contract-attestations'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const temporaryRoots: string[] = []
const ALL_MEMBERS = Object.freeze([
  ...AI_SOURCE_ATTESTATION_MEMBERS_V1,
  ...REVIEW_PROVIDER_SUBJECT_ATTESTATION_MEMBERS_V1,
])

function createContractRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-ai-attestation-'))
  temporaryRoots.push(root)
  for (const path of ALL_MEMBERS) {
    const destination = resolve(root, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, readFileSync(resolve(REPOSITORY_ROOT, path)))
  }
  return root
}

function mutateText(
  root: string,
  path: string,
  mutate: (source: string) => string,
): void {
  const absolutePath = resolve(root, path)
  writeFileSync(absolutePath, mutate(readFileSync(absolutePath, 'utf8')), 'utf8')
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('canonicalizer build attestations', () => {
  it('pins the assessed OpenAI SDK and Undici transport exactly', () => {
    expect(assertPinnedProviderDependencyVersions(REPOSITORY_ROOT)).toEqual({
      openai: '7.4.0',
      undici: '8.10.0',
    })
  })

  it('rejects drift from an assessed provider dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'repkey-ai-dependencies-'))
    temporaryRoots.push(root)
    writeFileSync(
      resolve(root, 'package.json'),
      JSON.stringify({ dependencies: { openai: '^7.4.0', undici: '8.10.0' } }),
    )
    expect(() => assertPinnedProviderDependencyVersions(root)).toThrow(
      /openai dependency must be pinned exactly to 7\.4\.0/,
    )
  })

  it('reproduces the exact ordered member hashes and profile digests', () => {
    const result = checkCanonicalizerAttestations(REPOSITORY_ROOT)
    expect(result).toEqual({
      sourceCanonicalizerDigest: SOURCE_CANONICALIZER_ATTESTATION_V1.digest,
      reviewProviderSubjectCanonicalizerDigest:
        REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1.digest,
    })
    expect(Object.keys(SOURCE_CANONICALIZER_ATTESTATION_V1.memberSha256)).toEqual(
      AI_SOURCE_ATTESTATION_MEMBERS_V1,
    )
    expect(
      Object.keys(REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1.memberSha256),
    ).toEqual(REVIEW_PROVIDER_SUBJECT_ATTESTATION_MEMBERS_V1)
  })

  it('canonicalizes vector JSON while preserving its required array order', () => {
    const root = createContractRoot()
    for (const path of [
      'src/shared/ai-review-source-v1.vectors.json',
      'src/shared/review-provider-subject-v1.vectors.json',
    ]) {
      mutateText(root, path, (raw) => `${JSON.stringify(JSON.parse(raw))}\n`)
    }
    expect(checkCanonicalizerAttestations(root)).toEqual({
      sourceCanonicalizerDigest: SOURCE_CANONICALIZER_ATTESTATION_V1.digest,
      reviewProviderSubjectCanonicalizerDigest:
        REVIEW_PROVIDER_SUBJECT_CANONICALIZER_ATTESTATION_V1.digest,
    })
  })

  it.each([
    'src/shared/ai-review-source-contract.ts',
    'src/shared/ai-review-source-v1.vectors.json',
    'scripts/generate-ai-unicode-case-folding.ts',
    'vendor/unicode/17.0.0/CaseFolding.txt',
    'src/shared/generated/ai-unicode-case-folding-v17.ts',
    'src/shared/review-provider-subject-contract.ts',
    'src/shared/review-provider-subject-v1.vectors.json',
  ])('rejects BOM and CR source bytes for %s', (path) => {
    const bomRoot = createContractRoot()
    mutateText(bomRoot, path, (raw) => `\uFEFF${raw}`)
    expect(() => checkCanonicalizerAttestations(bomRoot)).toThrow(/UTF-8 BOM/)

    const crRoot = createContractRoot()
    mutateText(crRoot, path, (raw) => raw.replace('\n', '\r\n'))
    expect(() => checkCanonicalizerAttestations(crRoot)).toThrow(/contains a CR byte/)
  })

  it.each([
    'src/shared/ai-review-source-v1.vectors.json',
    'src/shared/review-provider-subject-v1.vectors.json',
  ])('rejects duplicate JSON keys in %s', (path) => {
    const root = createContractRoot()
    mutateText(root, path, (raw) =>
      raw.replace('"vectorId":', '"vectorId":"duplicate","vectorId":'),
    )
    expect(() => checkCanonicalizerAttestations(root)).toThrow(/duplicate object key/)
  })

  it.each([
    'src/shared/ai-review-source-v1.vectors.json',
    'src/shared/review-provider-subject-v1.vectors.json',
  ])('rejects vector reordering in %s', (path) => {
    const root = createContractRoot()
    mutateText(root, path, (raw) => {
      const values = JSON.parse(raw) as unknown[]
      return `${JSON.stringify([values[1], values[0], ...values.slice(2)])}\n`
    })
    expect(() => checkCanonicalizerAttestations(root)).toThrow(/vector order drift/)
  })

  it.each([
    'src/shared/ai-review-source-v1.vectors.json',
    'src/shared/review-provider-subject-v1.vectors.json',
  ])('rejects a one-field vector mutation in %s', (path) => {
    const root = createContractRoot()
    mutateText(root, path, (raw) =>
      raw.replace(
        /[0-9a-f]{64}/u,
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      ),
    )
    expect(() => checkCanonicalizerAttestations(root)).toThrow(/digest mismatch/)
  })

  it('rejects a second or local source-canonicalizer runtime import', () => {
    const root = createContractRoot()
    mutateText(
      root,
      'src/shared/ai-review-source-contract.ts',
      (raw) => `import './unexpected-runtime-dependency'\n${raw}`,
    )
    expect(() => calculateSourceCanonicalizerAttestation(root)).toThrow(
      /must import only the exact generated case-fold table/,
    )
  })

  it('rejects runtime imports in the generated table and provider-subject local imports', () => {
    const tableRoot = createContractRoot()
    mutateText(
      tableRoot,
      'src/shared/generated/ai-unicode-case-folding-v17.ts',
      (raw) => `import './runtime'\n${raw}`,
    )
    expect(() => calculateSourceCanonicalizerAttestation(tableRoot)).toThrow(
      /must not contain a runtime import/,
    )

    const subjectRoot = createContractRoot()
    mutateText(
      subjectRoot,
      'src/shared/review-provider-subject-contract.ts',
      (raw) => `import './runtime'\n${raw}`,
    )
    expect(() => calculateReviewProviderSubjectAttestation(subjectRoot)).toThrow(
      /must not contain a local runtime import/,
    )
  })

  it('fails closed on generated-table or any other member drift', () => {
    const root = createContractRoot()
    mutateText(
      root,
      'src/shared/generated/ai-unicode-case-folding-v17.ts',
      (raw) => `${raw}\n`,
    )
    const actual = calculateSourceCanonicalizerAttestation(root)
    expect(() =>
      assertCanonicalizerAttestation(
        actual,
        SOURCE_CANONICALIZER_ATTESTATION_V1,
        'source',
      ),
    ).toThrow(/member digest mismatch/)
  })
})
