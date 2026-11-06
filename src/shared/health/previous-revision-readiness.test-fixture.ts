import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { ModuleKind, transpileModule } from 'typescript'

// Pin the released reader, so committing the compatibility change cannot
// silently turn the rollout proof into another test of the new reader.
const revision = 'bbec7dbbf35ddfe3072642a909231975d2109a33'

function source(path: string): string {
  return execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' })
}

export const previousJournal = JSON.parse(source('drizzle/meta/_journal.json')) as {
  entries: {
    idx: number
    tag: string
    when: number
    version: string
    breakpoints: boolean
  }[]
}

/** Execute the released probe and query, isolating only filesystem and I/O. */
export function previousRevisionReadiness(
  query: (sql: string) => Promise<unknown>,
): () => Promise<boolean> {
  const modules: Record<string, unknown> = {
    'node:fs': { readFileSync: () => JSON.stringify(previousJournal) },
    'node:path': { join },
    '#/shared/db/pool': { getPool: () => ({ query }) },
    '#/shared/observability/logger': { getLogger: () => ({ warn: () => {} }) },
    '#/shared/config/env': {},
    '#/shared/config/production-secrets': {},
    '#/shared/auth/beta-capabilities': {},
    './probes': {},
    './operations-snapshot': {},
  }
  function compile(path: string): Record<string, unknown> {
    const module = { exports: {} }
    const compiled = transpileModule(source(path), {
      compilerOptions: { module: ModuleKind.CommonJS },
    }).outputText
    runInNewContext(compiled, {
      module,
      exports: module.exports,
      process: { cwd: () => '/app' },
      require: (specifier: string) => {
        if (!(specifier in modules)) throw new Error(`Unexpected import: ${specifier}`)
        return modules[specifier]
      },
    })
    return module.exports
  }
  modules['./migration-lock-timeout'] = compile('src/shared/db/migration-lock-timeout.ts')
  modules['#/shared/db/migration-journal-state'] = compile(
    'src/shared/db/migration-journal-state.ts',
  )
  modules['./migration-version'] = compile('src/shared/health/migration-version.ts')
  return compile('src/shared/health/readiness.ts')
    .isMigrationJournalMatched as () => Promise<boolean>
}
