// BQR-4.1 — enabled-context server functions use requireAuthorized / authorize.
// BQC-2.4 — migrated paths use requireExecutionAllowed (ExecutionPolicy).
//
// Prevents regression to bare canForContext-only checks on production entry points.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src/contexts')

const ENABLED_CONTEXTS = [
  'property',
  'inbox',
  'review',
  'dashboard',
  'integration',
  'staff',
  'activity',
  'notification',
  'identity',
] as const

function listServerTs(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return listServerTs(p)
      if (name.endsWith('.ts') && !name.endsWith('.test.ts')) return [p]
      return []
    })
  } catch {
    return []
  }
}

function relative(path: string): string {
  return path.replace(process.cwd() + '/', '')
}

function gatesAuth(src: string): boolean {
  return (
    src.includes('requireAuthorized') ||
    src.includes('requireExecutionAllowed') ||
    src.includes('authorize(') ||
    src.includes('canForContext') ||
    src.includes('assertBetaCapability')
  )
}

function usesAuthorizeSeam(src: string): boolean {
  return (
    src.includes("from '#/shared/auth/authorization-policy'") ||
    src.includes("from '#/shared/auth/execution-policy'") ||
    src.includes('requireAuthorized') ||
    src.includes('requireExecutionAllowed') ||
    src.includes('authorize(')
  )
}

function collectOffenders(): string[] {
  const offenders: string[] = []
  for (const ctx of ENABLED_CONTEXTS) {
    for (const file of listServerTs(join(ROOT, ctx, 'server'))) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('createServerFn') && !src.includes('resolveTenantContext')) {
        continue
      }
      if (!gatesAuth(src)) continue
      if (!usesAuthorizeSeam(src)) offenders.push(relative(file))
    }
  }
  return offenders
}

describe('authorize server boundary (BQR-4.1)', () => {
  it('enabled-context server modules that gate auth use the authorize/ExecutionPolicy seam', () => {
    const offenders = collectOffenders()
    expect(offenders, `missing authorize seam:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the superseded requireAuthorized path is deleted (BQC-2.6)', () => {
    // After the dark-context migration, zero production callers remained —
    // authorization-policy.ts and its tests were removed. The mapping lives
    // in capability-for-permission.ts; the seam is execution-policy.ts.
    expect(
      existsSync(join(process.cwd(), 'src/shared/auth/authorization-policy.ts')),
    ).toBe(false)
    const map = readFileSync(
      join(process.cwd(), 'src/shared/auth/capability-for-permission.ts'),
      'utf8',
    )
    expect(map).toContain('export function capabilityForPermission')
  })

  // ARC-03-T13: the web framework is a composition-boundary choice. A context's
  // application or infrastructure layer that reaches for it — statically or by
  // dynamic import — cannot be built in a worker, sidecar or process fixture.
  describe('the ambient request context stays behind an injected port', () => {
    const FRAMEWORK = '@tanstack/react-start'

    const guardedFiles = (): string[] => [
      ...ENABLED_CONTEXTS.flatMap((ctx) => [
        ...listServerTs(join(ROOT, ctx, 'infrastructure')),
        ...listServerTs(join(ROOT, ctx, 'application')),
      ]),
      join(process.cwd(), 'src/composition.ts'),
    ]

    it('catches a dynamic import, not just a static one', () => {
      const fixture = "const m = await import('@tanstack/react-start/server')"
      expect(fixture).toContain(FRAMEWORK)
    })

    it('has no framework edge in context application/infrastructure or the root', () => {
      const offenders = guardedFiles()
        .filter((file) => readFileSync(file, 'utf8').includes(FRAMEWORK))
        .map(relative)
        .sort()

      expect(offenders).toEqual([])
    })

    it('keeps exactly one owner of the framework request adapter', () => {
      const adapter = readFileSync(
        join(process.cwd(), 'src/shared/auth/tanstack-request-context.ts'),
        'utf8',
      )
      const headers = readFileSync(
        join(process.cwd(), 'src/shared/auth/headers.ts'),
        'utf8',
      )

      expect(adapter).toContain(FRAMEWORK)
      expect(adapter).toContain('export function createTanstackRequestContext')
      // The legacy helper is now a thin call shape over the same adapter.
      expect(headers).not.toContain(FRAMEWORK)
      expect(headers).toContain('createTanstackRequestContext')
    })

    it('injects the session provider into the root instead of calling it', () => {
      const composition = readFileSync(join(process.cwd(), 'src/composition.ts'), 'utf8')

      expect(composition).not.toContain('getAuth(')
      expect(composition).not.toContain('headersFromContext')
      expect(composition).toContain('createBetterAuthSessionPort({ requestContext })')
      expect(composition).toContain('options?.authSession ??')
    })
  })

  it('execution-policy exports the BQC-2.4 seam', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/shared/auth/execution-policy.ts'),
      'utf8',
    )
    expect(src).toContain('export function createExecutionPolicy')
    expect(src).toContain('export async function requireExecutionAllowed')
    expect(src).toContain('export function initExecutionPolicy')
  })
})
