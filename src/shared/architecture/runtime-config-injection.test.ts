import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AMBIENT_RUNTIME_READ_AUTHORITY,
  AMBIENT_RUNTIME_READ_FORBIDDEN_PREFIXES,
  isAmbientRuntimeReadDeclared,
  PROCESS_SCOPED_IMPORT_TIME_TABLES,
} from './ambient-runtime-read-authority'

const ROOT = process.cwd()
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

/**
 * Comments describe ambient reads all over this codebase (they are the thing
 * being removed), so the scanner works on code only. Line-by-line rather than
 * by regex: a `//` comment that mentions a glob such as `shared/observability`
 * would otherwise open a phantom block comment and swallow real code.
 */
function stripComments(source: string): string {
  let inBlockComment = false
  return source
    .split('\n')
    .map((line) => {
      let code = ''
      let index = 0
      while (index < line.length) {
        if (inBlockComment) {
          const end = line.indexOf('*/', index)
          if (end === -1) break
          inBlockComment = false
          index = end + 2
          continue
        }
        const lineComment = line.indexOf('//', index)
        const blockComment = line.indexOf('/*', index)
        if (blockComment !== -1 && (lineComment === -1 || blockComment < lineComment)) {
          code += line.slice(index, blockComment)
          inBlockComment = true
          index = blockComment + 2
          continue
        }
        if (lineComment !== -1) {
          code += line.slice(index, lineComment)
          break
        }
        code += line.slice(index)
        break
      }
      return code
    })
    .join('\n')
}

/** A read bound to import order rather than to a call. */
function readsAmbientRuntimeAtModuleScope(source: string): boolean {
  return /^(?:const|let|var)\s[^\n]*(?:getEnv\s*\(|process\.env)/mu.test(
    stripComments(source),
  )
}

function readsAmbientRuntime(source: string): boolean {
  const code = stripComments(source)
  return /\bgetEnv\s*\(/u.test(code) || /\bprocess\.env\b/u.test(code)
}

function productionSources(directory: string): string[] {
  const entries = readdirSync(join(ROOT, directory), { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return productionSources(path)
    if (!/\.tsx?$/u.test(entry.name)) return []
    if (/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/u.test(entry.name)) return []
    return [path]
  })
}

const EXCLUDED = [
  // The parser itself is where configuration comes from.
  'src/shared/config/env.ts',
  // Test-only harnesses.
  'src/shared/testing/',
  'src/test-setup.ts',
  // The authority and this test name the reads they govern.
  'src/shared/architecture/ambient-runtime-read-authority.ts',
] as const

describe('ARC-03-T14 ambient runtime read authority', () => {
  const scanned = (): string[] =>
    [...productionSources('src'), ...productionSources('server')].filter(
      (file) => !EXCLUDED.some((excluded) => file.startsWith(excluded)),
    )

  it('fails on an undeclared file (fixture proving the matcher works)', () => {
    expect(readsAmbientRuntime('const x = getEnv().PROCESSING_CELL')).toBe(true)
    expect(readsAmbientRuntime('const x = process.env.FOO')).toBe(true)
    // A comment about the ban is not a violation of it.
    expect(readsAmbientRuntime('// this used to read process.env directly')).toBe(false)
    expect(isAmbientRuntimeReadDeclared('src/routes/api/invented.ts')).toBe(false)
  })

  it('declares every production ambient runtime read with a reason', () => {
    const undeclared = scanned()
      .filter((file) => readsAmbientRuntime(read(file)))
      .filter((file) => !isAmbientRuntimeReadDeclared(file))
      .sort()

    expect(
      undeclared,
      `undeclared ambient runtime reads:\n${undeclared.join('\n')}`,
    ).toEqual([])
    for (const entry of AMBIENT_RUNTIME_READ_AUTHORITY) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(40)
    }
  })

  it('keeps the authority free of stale entries', () => {
    const stale = AMBIENT_RUNTIME_READ_AUTHORITY.map((entry) => entry.file)
      .filter((file) => existsSync(join(ROOT, file)))
      .filter((file) => !readsAmbientRuntime(read(file)))
      .sort()

    expect(stale, `declared but no longer reading:\n${stale.join('\n')}`).toEqual([])
    for (const entry of AMBIENT_RUNTIME_READ_AUTHORITY) {
      expect(existsSync(join(ROOT, entry.file)), entry.file).toBe(true)
    }
  })

  it('records the import-time constant tables it deliberately leaves alone', () => {
    // The ARC-03 risk register calls these out by name: they are pure tables,
    // not runtime state, so converting them would be churn with a regression
    // surface and no benefit.
    expect(PROCESS_SCOPED_IMPORT_TIME_TABLES.map((entry) => entry.file)).toEqual([
      'src/shared/auth/permissions.ts',
    ])
    const permissions = read('src/shared/auth/permissions.ts')
    expect(permissions).toContain('initPermissionTable()')
    // Pure means pure: it must not consult the environment.
    expect(readsAmbientRuntime(permissions)).toBe(false)
  })

  it('permits no entry point or context internal to read configuration itself', () => {
    const forbidden = AMBIENT_RUNTIME_READ_AUTHORITY.filter((entry) =>
      AMBIENT_RUNTIME_READ_FORBIDDEN_PREFIXES.some((prefix) =>
        entry.file.startsWith(prefix),
      ),
    ).map((entry) => entry.file)

    expect(forbidden).toEqual([])
  })

  it('detects a module-scope read (fixture proving the matcher works)', () => {
    expect(readsAmbientRuntimeAtModuleScope('const env = getEnv()\n')).toBe(true)
    expect(
      readsAmbientRuntimeAtModuleScope(
        'export default () => {\n  const env = getEnv()\n}',
      ),
    ).toBe(false)
  })

  it('lets no server plugin bind its configuration to import order', () => {
    const offenders = AMBIENT_RUNTIME_READ_AUTHORITY.filter(
      (entry) => entry.category === 'server_plugin',
    )
      .filter((entry) => readsAmbientRuntimeAtModuleScope(read(entry.file)))
      .map((entry) => entry.file)

    expect(offenders).toEqual([])
    // The plugin the survey named explicitly: it used to read at module load.
    const requestGuard = read('server/plugins/request-guard.ts')
    expect(requestGuard).toContain('const env = getEnv()')
    expect(requestGuard).toMatch(/definePlugin\(\(\w+\) => \{/u)
  })

  it('lets a process fixture inject the sidecar provider environment', () => {
    expect(read('src/composition.ts')).toContain(
      'runtimeEnvironment: options?.runtimeEnvironment ?? process.env',
    )
    // The injection point is declared with the rest of the container options.
    expect(read('src/composition/container-options.ts')).toContain(
      'runtimeEnvironment?: NodeJS.ProcessEnv',
    )
  })

  it('routes the HTTP edge through the one request-runtime-config owner', () => {
    for (const route of [
      'src/routes/api/auth/$.ts',
      'src/routes/api/auth/google/callback.ts',
      'src/routes/api/health/metrics.ts',
      'src/routes/api/notifications/unsubscribe.ts',
      'src/routes/api/webhooks/gbp/notifications.ts',
      'src/routes/api/webhooks/resend/events.ts',
    ]) {
      const source = read(route)
      expect(source, route).toContain('requestRuntimeConfig')
      expect(readsAmbientRuntime(source), route).toBe(false)
    }
  })
})

describe('ARC-03 parsed runtime dependency injection', () => {
  it('keeps ambient environment reads out of every retained context build', () => {
    const contextsRoot = join(ROOT, 'src/contexts')
    const buildFiles = readdirSync(contextsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/contexts/${entry.name}/build.ts`)
      .filter((file) => existsSync(join(ROOT, file)))

    const violations = buildFiles.filter((file) => {
      const source = read(file)
      return (
        /\bget(?:Env|Redis|Logger)\s*\(/u.test(source) || /\bprocess\.env\b/u.test(source)
      )
    })
    expect(violations).toEqual([])
  })

  it('makes worker registration consume injected config, Redis, logging, and time', () => {
    const source = read('src/bootstrap.ts')
    expect(source).not.toMatch(/\bget(?:Env|Redis|Logger|Pool)\s*\(/u)
    expect(source).toContain('runtime: BootstrapRuntimeConfig')
    expect(source).toContain('container.redis')
    expect(source).toContain('container.logger')
    expect(source).toContain('container.clock')
    expect(source).toContain('container.pool')
  })

  it('keeps the Review publication sweep lease bound to its injected pool', () => {
    const source = read(
      'src/contexts/review/infrastructure/publication-reconciliation-run-lease.ts',
    )
    expect(source).not.toMatch(/\bgetPool\s*\(/u)
    expect(source).toContain("Pick<Pool, 'connect'>")
  })

  it('keeps Review event-consumer logging owned by the context build', () => {
    for (const file of [
      'src/contexts/review/infrastructure/event-handlers/on-google-account-disconnected.ts',
      'src/contexts/review/infrastructure/outbox-consumers.ts',
    ]) {
      expect(read(file), file).not.toMatch(/\bgetLogger\s*\(/u)
    }
    expect(
      read(
        'src/contexts/review/infrastructure/event-handlers/on-google-account-disconnected.ts',
      ),
    ).toContain('logger: ReviewEventLogger')
    expect(read('src/contexts/review/infrastructure/outbox-consumers.ts')).toContain(
      'logger: ReviewOutboxLogger',
    )
  })

  it('keeps Review job logging owned by worker composition', () => {
    for (const file of [
      'src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts',
      'src/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job.ts',
      'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
      'src/contexts/review/infrastructure/jobs/discover-new-reviews.job.ts',
      'src/contexts/review/infrastructure/jobs/publish-reply.job.ts',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source, file).toMatch(/\blogger:\s*Pick<LoggerPort,/u)
    }
  })

  it('keeps Review source-content classification clock-explicit', () => {
    const source = read('src/contexts/review/application/source-content-lifecycle.ts')
    expect(source).not.toMatch(/now:\s*Date\s*=\s*new Date/u)
  })

  it('keeps Review persistence clocks owned by the context build', () => {
    for (const file of [
      'src/contexts/review/infrastructure/review-command-store.ts',
      'src/contexts/review/infrastructure/reply-command-store.ts',
      'src/contexts/review/infrastructure/repositories/review.repository.ts',
      'src/contexts/review/infrastructure/repositories/reply.repository.ts',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
    }

    const build = read('src/contexts/review/build.ts')
    expect(build).toContain('createReviewRepository(input.db, input.clock)')
    expect(build).toContain('createReplyRepository(input.db, input.clock)')
    expect(build).toMatch(
      /createAtomicReviewCommandStore\(\s*input\.db,\s*input\.events,\s*input\.clock\s*,?\s*\)/u,
    )
    expect(build).toContain('input.clock,\n    input.publicationActorAuthority,')
  })

  it('keeps the notification provider adapter deterministic after construction', () => {
    const source = read(
      'src/contexts/notification/infrastructure/adapters/resend-email.adapter.ts',
    )
    expect(source).not.toMatch(/\bget(?:Env|Logger)\s*\(/u)
    expect(source).not.toMatch(/\bnew Date\s*\(/u)
    expect(source).toContain('dependencies.config')
    expect(source).toContain('dependencies.clock()')
  })

  it('keeps the network-free notification sender on the same injected clock contract', () => {
    const source = read(
      'src/contexts/notification/infrastructure/adapters/capturing-email-sender.adapter.ts',
    )
    expect(source).toContain('clock: () => Date')
    expect(source).not.toMatch(/clock\?:/u)
    expect(source).not.toMatch(/new Date\s*\(/u)
  })

  it('requires an injected clock at Google authorization boundaries', () => {
    for (const file of [
      'src/contexts/integration/application/google-import-command-authorizer.ts',
      'src/contexts/integration/application/google-performance-authorizer.ts',
    ]) {
      const source = read(file)
      expect(source, file).toContain('clock: () => Date')
      expect(source, file).not.toMatch(/clock\?:\s*\(\)\s*=>\s*Date/u)
      expect(source, file).not.toMatch(/deps\.clock\s*\?\?/u)
    }
  })

  it('requires injected time and identifiers for Inbox commands', () => {
    for (const file of [
      'src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts',
      'src/contexts/inbox/application/use-cases/bulk-assign-inbox-items.ts',
      'src/contexts/inbox/application/use-cases/mark-feedback-handled.ts',
      'src/contexts/inbox/application/use-cases/correct-feedback-handling-outcome.ts',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/crypto\.randomUUID\s*\(/u)
      expect(source, file).not.toMatch(/\?\?\s*new Date\s*\(/u)
      expect(source, file).not.toMatch(/(?:clock|idGen|bulkIdGen)\?:/u)
    }
  })

  it('keeps AI persistence and scheduler identifiers composition-owned', () => {
    const build = read('src/contexts/ai/build.ts')
    expect(build).toContain('idGen: () => string')
    expect(build).toContain('nowEpochMillis: () => number')
    expect(build).not.toMatch(/(?:idGen|nowEpochMillis)\?:/u)

    for (const file of [
      'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
      'src/contexts/ai/infrastructure/adapters/ai-property-trend-schedule-store.adapter.ts',
      'src/contexts/ai/infrastructure/adapters/ai-quota.adapter.ts',
      'src/contexts/ai/infrastructure/adapters/ai-review-analysis-backfill.adapter.ts',
      'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts',
      'src/contexts/ai/infrastructure/jobs/schedule-property-trends.job.ts',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/(?:crypto\.)?randomUUID/u)
    }

    expect(
      read(
        'src/contexts/ai/infrastructure/adapters/property-processing-profile.adapter.ts',
      ),
    ).not.toMatch(/new Date\(\)/u)
  })

  it('keeps Staff identifiers and mutation timestamps caller-owned', () => {
    const build = read('src/contexts/staff/build.ts')
    expect(build).toContain('idGen: () => string')
    expect(build).not.toMatch(/(?:crypto\.)?randomUUID/u)

    const store = read('src/contexts/staff/infrastructure/staff-command-store.ts')
    expect(store).not.toMatch(/new Date\(\)/u)
    expect(store).toContain('command.event.occurredAt')
  })

  it('keeps Identity time, identifiers, and policy logging composition-owned', () => {
    const build = read('src/contexts/identity/build.ts')
    expect(build).toContain('idGen: () => string')
    expect(build).not.toMatch(/(?:crypto\.)?randomUUID/u)

    for (const file of [
      'src/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter.ts',
      'src/contexts/identity/infrastructure/identity-command-store.ts',
      'src/contexts/identity/infrastructure/repositories/member-property-authority.ts',
      'src/contexts/identity/infrastructure/repositories/merchant-ai-authorization.repository.ts',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/Date\.now\s*\(/u)
      expect(source, file).not.toMatch(/new Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/(?:crypto\.)?randomUUID/u)
    }

    expect(
      read(
        'src/contexts/identity/infrastructure/repositories/merchant-ai-authorization.repository.ts',
      ),
    ).not.toMatch(/\bgetLogger\s*\(/u)

    const policy = read('src/contexts/identity/infrastructure/policy-store-init.ts')
    expect(policy).not.toMatch(/\bgetLogger\s*\(/u)
    expect(policy).toContain('clock: () => Date')
    expect(policy).toContain('logger: PolicyStoreLogger')
  })

  it('keeps Metric reading and correction identifiers composition-owned', () => {
    const build = read('src/contexts/metric/build.ts')
    expect(build).toContain('idGen: () => string')
    expect(build).not.toMatch(/(?:crypto\.)?randomUUID/u)

    const store = read('src/contexts/metric/infrastructure/metric-command-store.ts')
    expect(store).not.toMatch(/(?:crypto\.)?randomUUID/u)
  })
})
