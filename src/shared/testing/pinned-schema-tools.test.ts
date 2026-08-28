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
    expect(manifest.scripts['db:migrate-deploy']).toBe('tsx scripts/migrate-deploy.ts')
  })

  it('keeps the normal fresh-database instructions on the production deploy authority', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
    const quickStart = /## Quick Start([\s\S]*?)## Architecture/u.exec(readme)?.[1]

    expect(quickStart).toContain('pnpm db:migrate-deploy')
    expect(quickStart).not.toContain('pnpm db:bootstrap-auth')
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

  it('starts the shadcn MCP server through the repository-installed CLI', () => {
    const mcpConfig = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>
    }
    const codexConfig = readFileSync(resolve(root, '.codex/config.toml'), 'utf8')
    const authoritativeGuidance = [
      readFileSync(resolve(root, 'README.md'), 'utf8'),
      readFileSync(resolve(root, 'package.json'), 'utf8'),
      JSON.stringify(mcpConfig),
      codexConfig,
    ].join('\n')

    expect(mcpConfig.mcpServers.shadcn).toEqual({
      command: 'pnpm',
      args: ['exec', 'shadcn', 'mcp'],
    })
    expect(codexConfig).toContain('command = "pnpm"')
    expect(codexConfig).toMatch(/args = \[\s*"exec",\s*"shadcn",\s*"mcp",?\s*\]/u)
    expect(authoritativeGuidance).not.toMatch(/\bnpx\s+-y\b|@latest|\bpnpm\s+dlx\b/u)
  })
})
