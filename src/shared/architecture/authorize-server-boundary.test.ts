// BQR-4.1 — enabled-context server functions use requireAuthorized / authorize.
//
// Prevents regression to bare canForContext-only checks on production entry points
// for beta-enabled surfaces (property, inbox, review, dashboard, integration, …).

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
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...listServerTs(p))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

describe('authorize server boundary (BQR-4.1)', () => {
  it('enabled-context server modules that gate auth import requireAuthorized or authorize', () => {
    const offenders: string[] = []

    for (const ctx of ENABLED_CONTEXTS) {
      const serverDir = join(ROOT, ctx, 'server')
      for (const file of listServerTs(serverDir)) {
        const src = readFileSync(file, 'utf8')
        // Skip pure re-export / helper modules with no tenant handlers
        if (!src.includes('resolveTenantContext') && !src.includes('createServerFn')) {
          continue
        }
        // Files that perform auth checks should use the authorize seam
        const gatesAuth =
          src.includes('requireAuthorized') ||
          src.includes('authorize(') ||
          src.includes('canForContext') ||
          src.includes('assertBetaCapability')
        if (!gatesAuth) continue

        const usesAuthorizeSeam =
          src.includes("from '#/shared/auth/authorization-policy'") ||
          src.includes('requireAuthorized') ||
          src.includes('authorize(')

        // Soft redaction checks (e.g. reply.manage for field filtering) may keep
        // canForContext alongside requireAuthorized — require at least one seam import.
        if (!usesAuthorizeSeam && src.includes('canForContext(')) {
          // allow canForContext only when requireAuthorized also present
          offenders.push(file.replace(process.cwd() + '/', ''))
        }
        if (!usesAuthorizeSeam && src.includes('assertBetaCapability')) {
          // enabled contexts should not rely solely on assertBetaCapability
          offenders.push(file.replace(process.cwd() + '/', ''))
        }
      }
    }

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
