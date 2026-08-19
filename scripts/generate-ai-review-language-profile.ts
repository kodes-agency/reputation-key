import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { canonicalizeRfc8785 } from '../src/shared/merchant-ai-notice-contract'
import { computeAiLanguageProfileDigest } from './ai-language-attestation'
import {
  AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST,
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '../src/shared/generated/ai-review-language-canonical-regions-v1'

const ROOT = resolve(import.meta.dirname, '..')
const OUTPUT = resolve(ROOT, 'src/shared/ai-review-language-catalogue-v1.manifest.json')
const WRAPPER_PATH = 'src/shared/ai-review-language-catalogue.ts'
const TAG_VECTORS_PATH = 'src/shared/ai-review-language-tag-v1.vectors.json'
const REGION_GENERATOR_PATH = 'scripts/generate-ai-review-language-regions.ts'
const REGION_TABLE_PATH =
  'src/shared/generated/ai-review-language-canonical-regions-v1.ts'
const VECTORS_PATH = 'src/shared/ai-review-language-v1.vectors.json'
const GROUPS = Object.freeze([
  'und',
  'en-Latn',
  'es-Latn',
  'fr-Latn',
  'de-Latn',
  'pt-Latn',
  'it-Latn',
  'nl-Latn',
  'pl-Latn',
  'tr-Latn',
  'uk-Cyrl',
  'ru-Cyrl',
  'ar-Arab',
  'he-Hebr',
  'hi-Deva',
  'bn-Beng',
  'ta-Taml',
  'th-Thai',
  'vi-Latn',
  'id-Latn',
  'zh-Hans',
  'zh-Hant',
  'ja-Jpan',
  'ko-Kore',
  'bg-Cyrl',
] as const)

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

const wrapperBytes = readFileSync(resolve(ROOT, WRAPPER_PATH))
const vectors = JSON.parse(readFileSync(resolve(ROOT, VECTORS_PATH), 'utf8')) as unknown
const canonicalVectorBytes = Buffer.from(canonicalizeRfc8785(vectors), 'utf8')
const tagVectors = JSON.parse(
  readFileSync(resolve(ROOT, TAG_VECTORS_PATH), 'utf8'),
) as unknown
const canonicalTagVectorBytes = Buffer.from(canonicalizeRfc8785(tagVectors), 'utf8')
const regionGeneratorBytes = readFileSync(resolve(ROOT, REGION_GENERATOR_PATH))
const regionTableBytes = readFileSync(resolve(ROOT, REGION_TABLE_PATH))
const manifest = Object.freeze({
  version: 'ai-review-language-catalogue-v1',
  unicodeVersion: '17.0.0',
  icuVersion: '78.2',
  groups: GROUPS,
  wrapper: Object.freeze({
    path: WRAPPER_PATH,
    sha256: sha256(wrapperBytes),
  }),
  vectors: Object.freeze({
    path: VECTORS_PATH,
    sha256: sha256(canonicalVectorBytes),
  }),
  tagVectors: Object.freeze({
    path: TAG_VECTORS_PATH,
    sha256: sha256(canonicalTagVectorBytes),
  }),
  canonicalRegions: Object.freeze({
    digest: AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST,
    nodeVersion: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
    icuVersion: AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
    unicodeVersion: AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
    generator: Object.freeze({
      path: REGION_GENERATOR_PATH,
      sha256: sha256(regionGeneratorBytes),
    }),
    table: Object.freeze({
      path: REGION_TABLE_PATH,
      sha256: sha256(regionTableBytes),
    }),
  }),
  attestationDigest: computeAiLanguageProfileDigest(
    'repkey-ai-review-language-catalogue-v1\0',
    [
      { path: WRAPPER_PATH, bytes: wrapperBytes },
      { path: VECTORS_PATH, bytes: canonicalVectorBytes },
      { path: TAG_VECTORS_PATH, bytes: canonicalTagVectorBytes },
      { path: REGION_GENERATOR_PATH, bytes: regionGeneratorBytes },
      { path: REGION_TABLE_PATH, bytes: regionTableBytes },
    ],
  ),
})
const generated = `${JSON.stringify(manifest, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(OUTPUT, 'utf8') !== generated)
    throw new Error('Review language profile is stale')
  process.stdout.write('Review language profile is current\n')
} else {
  writeFileSync(OUTPUT, generated, 'utf8')
  process.stdout.write(`Generated ${OUTPUT}\n`)
}
