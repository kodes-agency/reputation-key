// BQR-4.1 — enabled-context server functions use requireAuthorized / authorize.
//
// Prevents regression to bare canForContext-only checks on production entry points.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
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
    src.includes('authorize(') ||
    src.includes('canForContext') ||
    src.includes('assertBetaCapability')
  )
}

function usesAuthorizeSeam(src: string): boolean {
  return (
    src.includes("from '#/shared/auth/authorization-policy'") ||
    src.includes('requireAuthorized') ||
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
  it('enabled-context server modules that gate auth import requireAuthorized or authorize', () => {
    const offenders = collectOffenders()
    expect(offenders, `missing authorize seam:\n${offenders.join('\n')}`).toEqual([])
  })

  it('authorization-policy exports requireAuthorized and capabilityForPermission', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/shared/auth/authorization-policy.ts'),
      'utf8',
    )
    expect(src).toContain('export function requireAuthorized')
    expect(src).toContain('export function capabilityForPermission')
    expect(src).toContain('export function authorize')
  })
})
