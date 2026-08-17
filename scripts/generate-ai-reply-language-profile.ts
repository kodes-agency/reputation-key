import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { canonicalizeRfc8785 } from '../src/shared/merchant-ai-notice-contract'
import { LANGUAGE_CATALOGUE_DIGEST } from '../src/shared/ai-review-language-catalogue'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '../src/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '../src/shared/ai-zh-orthography-verifier'
import { computeAiLanguageProfileDigest } from './ai-language-attestation'
import { format, resolveConfig } from 'prettier'

const ROOT = resolve(import.meta.dirname, '..')
const PRETTIER_CONFIG = (await resolveConfig(resolve(ROOT, 'package.json'))) ?? {}
const OUTPUT = resolve(ROOT, 'src/shared/ai-reply-language-verifier-v1.manifest.json')
const WRAPPER = 'src/shared/ai-reply-language-verifier.ts'
const VECTORS = 'src/shared/ai-reply-language-verifier-v1.vectors.json'
const CLD3_ASSET = 'node_modules/cld3-asm/dist/cjs/lib/node/cld3.js'
const CLD3_ASSET_SHA256 =
  '3f14aa4639bcf6e4cdf29f2125b337ed7cff41f49dad291621ce8f5a414f8840'
const CLD3_INTEGRITY =
  'sha512-eQq2detA7A54X9NSeunvHf4KcWlZKE/i98+V6NjWNDqF28GGk8Qk9XWApSywBjEcmPKR48zkabFWBoa1ExM/AQ=='

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const packageJson = JSON.parse(
  readFileSync(resolve(ROOT, 'node_modules/cld3-asm/package.json'), 'utf8'),
) as {
  version?: unknown
}
if (packageJson.version !== '4.0.0') throw new Error('cld3-asm version drift')
if (sha256(readFileSync(resolve(ROOT, CLD3_ASSET))) !== CLD3_ASSET_SHA256) {
  throw new Error('cld3-asm embedded WASM/runtime asset drift')
}
const wrapperBytes = readFileSync(resolve(ROOT, WRAPPER))
if (wrapperBytes[0] === 0xef || wrapperBytes.includes(0x0d)) {
  throw new Error('Reply language verifier source must use UTF-8/no-BOM/LF')
}
const vectorValue = JSON.parse(readFileSync(resolve(ROOT, VECTORS), 'utf8')) as unknown
const canonicalVectorBytes = Buffer.from(canonicalizeRfc8785(vectorValue), 'utf8')
const profileManifest = {
  version: 'reply-language-verifier-v1',
  unicodeVersion: '17.0.0',
  icuVersion: '78.2',
  package: { name: 'cld3-asm', version: '4.0.0', integrity: CLD3_INTEGRITY },
  embeddedWasmRuntime: { path: CLD3_ASSET, sha256: CLD3_ASSET_SHA256 },
  vectors: {
    path: VECTORS,
    sha256: sha256(canonicalVectorBytes),
    cases: vectorValue,
  },
  constants: { minimumLetters: 24, minimumProbability: 0.85, reliableRequired: true },
  labelMap: {
    ar: 'ar-Arab',
    bn: 'bn-Beng',
    de: 'de-Latn',
    en: 'en-Latn',
    es: 'es-Latn',
    fr: 'fr-Latn',
    he: 'he-Hebr',
    hi: 'hi-Deva',
    id: 'id-Latn',
    it: 'it-Latn',
    iw: 'he-Hebr',
    ja: 'ja-Jpan',
    ko: 'ko-Kore',
    nl: 'nl-Latn',
    pl: 'pl-Latn',
    pt: 'pt-Latn',
    ru: 'ru-Cyrl',
    ta: 'ta-Taml',
    th: 'th-Thai',
    tr: 'tr-Latn',
    uk: 'uk-Cyrl',
    vi: 'vi-Latn',
    zh: 'zh-Hans|zh-Hant',
  },
  dependencies: {
    languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
    languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
    zhOrthographyDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
  },
}
const profileBytes = Buffer.from(canonicalizeRfc8785(profileManifest), 'utf8')
const manifest = {
  ...profileManifest,
  wrapper: { path: WRAPPER, sha256: sha256(wrapperBytes) },
  attestationDigest: computeAiLanguageProfileDigest(
    'repkey-reply-language-verifier-profile-v1\0',
    [
      { path: WRAPPER, bytes: wrapperBytes },
      {
        path: 'src/shared/ai-reply-language-verifier-v1.profile.json',
        bytes: profileBytes,
      },
    ],
  ),
}
const generated = await format(canonicalizeRfc8785(manifest), {
  ...PRETTIER_CONFIG,
  filepath: OUTPUT,
})
if (process.argv.includes('--check')) {
  if (readFileSync(OUTPUT, 'utf8') !== generated)
    throw new Error('Reply language verifier manifest is stale')
  process.stdout.write('Reply language verifier manifest is current\n')
} else {
  writeFileSync(OUTPUT, generated, 'utf8')
  process.stdout.write(`Generated ${OUTPUT}\n`)
}
