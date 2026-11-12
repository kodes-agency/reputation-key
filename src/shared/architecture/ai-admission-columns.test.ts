// The four admission handshake columns of `ai_operations` and the keys that fed
// them are history: nothing reads or writes the columns, and no configuration
// carries the keys. Only the schema declares the columns, so a later migration
// can drop them without a reader to find first.
//
// This reads source text. Test code is walked too, because a test that seeds
// the columns would keep a writer alive. The names are assembled from fragments
// so this file cannot match itself.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const WALKED = ['src', 'scripts', 'services', 'e2e', '.railway'] as const
const WALKED_FILES = ['.env.example', '.gitleaks.toml'] as const

const SCHEMA = join('src', 'shared', 'db', 'schema', 'ai.schema.ts')
// Generated from the migrations, which declare the columns by definition.
const GENERATED = [join('src', 'shared', 'db', 'structure.sql')] as const

const NAMES = new RegExp(
  [
    '\\b(?:admission',
    'Nonce|request',
    'BindingKeyId|request',
    'BindingHmac|grant',
    'Kid)\\b|\\b(?:admission',
    '_nonce|request',
    '_binding_key_id|request',
    '_binding_hmac|grant',
    '_kid)\\b|\\bAI_(?:ADMISSION',
    '_ED25519_|REQUEST',
    '_BINDING_|ADMISSION',
    '_KEYRING_)',
  ].join(''),
  'u',
)

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules') return []
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = [
  ...WALKED.flatMap((root) => walk(join(ROOT, root))),
  ...WALKED_FILES.map((file) => join(ROOT, file)).filter(existsSync),
]
  .map((full) => relative(ROOT, full))
  .filter((file) => /\.(?:tsx?|mjs|json|toml|env|example|ya?ml|sql|md)$/u.test(file))
  .filter((file) => !(GENERATED as readonly string[]).includes(file))

describe('AI admission handshake columns', () => {
  it('walks a tree that contains the schema', () => {
    // A broken walk would make the assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(500)
    expect(existsSync(join(ROOT, SCHEMA))).toBe(true)
    expect(NAMES.test(readFileSync(join(ROOT, SCHEMA), 'utf8'))).toBe(true)
  })

  it('names the columns and their keys nowhere outside the schema', () => {
    const named = files
      .filter((file) => file !== SCHEMA && file !== relative(ROOT, __filename))
      .filter((file) => NAMES.test(readFileSync(join(ROOT, file), 'utf8')))
    expect(named).toEqual([])
  })

  it('knows the shapes it polices', () => {
    const camel = ['admission', 'Nonce'].join('')
    const snake = ['request', '_binding', '_hmac'].join('')
    const env = ['AI_ADMISSION', '_ED25519_KID'].join('')
    expect(NAMES.test(`row.${camel}`)).toBe(true)
    expect(NAMES.test(`SELECT ${snake} FROM ai_operations`)).toBe(true)
    expect(NAMES.test(`${env}=x`)).toBe(true)
    expect(NAMES.test('AI_PROVENANCE_ED25519_KID')).toBe(false)
    expect(NAMES.test('grantNonceRegistry')).toBe(false)
  })
})
