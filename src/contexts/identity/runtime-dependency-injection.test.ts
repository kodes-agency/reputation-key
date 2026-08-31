import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const IDENTITY_ROOT = join(process.cwd(), 'src/contexts/identity')
const ROOT = process.cwd()

const productionFiles = (directory = ''): string[] =>
  readdirSync(join(IDENTITY_ROOT, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = join(directory, entry.name)
      if (entry.isDirectory()) return productionFiles(relativePath)
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [relativePath]
        : []
    },
  )

describe('Identity runtime dependency injection', () => {
  it('keeps Identity production code independent from ambient runtime state', () => {
    for (const file of productionFiles()) {
      const source = readFileSync(join(IDENTITY_ROOT, file), 'utf8')
      expect(source, file).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source, file).not.toMatch(/\bget(?:Db|Env|Pool|Redis)\s*\(/u)
      expect(source, file).not.toMatch(/\bprocess\.env\b/u)
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, file).not.toMatch(/\brandomUUID\s*\(/u)
      expect(source, file).not.toMatch(/\bMath\.random\s*\(/u)
    }
  })

  it('makes the context build own Identity runtime wiring', () => {
    const source = readFileSync(join(IDENTITY_ROOT, 'build.ts'), 'utf8')
    expect(source).toContain('logger: LoggerPort')
    expect(source).toContain('clock: Clock')
    expect(source).toContain('idGen: () => string')
  })

  it('supplies Identity adapter, request, and worker dependencies at composition roots', () => {
    const composition = readFileSync(join(ROOT, 'src/composition.ts'), 'utf8')
    const bootstrap = readFileSync(join(ROOT, 'src/bootstrap.ts'), 'utf8')

    expect(composition).toMatch(
      /createBetterAuthIdentityAdapter\(db, \{[\s\S]*?clock,[\s\S]*?idGen: randomUUID,[\s\S]*?logger,[\s\S]*?\}\)/u,
    )
    // ARC-03-T13: the session is injected as an Identity-owned port. The root
    // selects the better-auth implementation; it no longer performs one.
    expect(composition).toContain('createBetterAuthSessionPort({ requestContext })')
    expect(composition).toContain('authSession,')
    expect(composition).not.toContain('getAuth(')
    expect(composition).toContain('identityRequestSecurity: Object.freeze({')
    expect(bootstrap).toMatch(
      /createRecoverInvitedRegistrationsHandler\(\{[\s\S]*?logger: container\.logger/u,
    )
  })
})
