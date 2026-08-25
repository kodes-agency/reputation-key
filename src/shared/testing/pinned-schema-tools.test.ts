import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

describe('schema tool supply-chain posture', () => {
  it('runs Better Auth schema operations through the installed runtime', () => {
    expect(manifest.dependencies['better-auth']).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(manifest.scripts['auth:generate']).toBe(
      'tsx scripts/better-auth-schema.ts generate',
    )
    expect(manifest.scripts['auth:migrate']).toBe(
      'tsx scripts/better-auth-schema.ts migrate',
    )
  })

  it('pins environment tooling and never network-fetches it in schema commands', () => {
    expect(manifest.devDependencies['dotenv-cli']).toMatch(/^\d+\.\d+\.\d+$/u)

    for (const script of [
      'auth:generate',
      'auth:migrate',
      'db:bootstrap-auth',
      'db:matviews',
      'audit:auth-schema',
    ]) {
      expect(manifest.scripts[script], script).not.toMatch(/\bnpx\b/u)
    }
  })
})
