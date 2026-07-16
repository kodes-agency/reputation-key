// Shared E2E seed state written by scripts/seed-e2e-user.ts.
// Critical specs prefer this over UI-driven discovery (no /properties/new; list
// row clicks are client-side and flaky under Playwright hydration).

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type E2eSeedState = Readonly<{
  email: string
  organizationId: string
  propertyId: string
  propertyName: string
  propertySlug: string
}>

/** Path relative to repo root (CI cwd and local playwright cwd). */
export const E2E_SEED_STATE_PATH = resolve(process.cwd(), 'e2e/.seed-state.json')

export function readE2eSeedState(): E2eSeedState | null {
  const fromEnv = process.env.E2E_TEST_PROPERTY_ID
  if (fromEnv && fromEnv.length > 0) {
    return {
      email: process.env.E2E_TEST_EMAIL ?? 'test@example.com',
      organizationId: process.env.E2E_TEST_ORG_ID ?? '',
      propertyId: fromEnv,
      propertyName: process.env.E2E_TEST_PROPERTY ?? 'E2E Seed Property',
      propertySlug: process.env.E2E_TEST_PROPERTY_SLUG ?? 'e2e-seed-property',
    }
  }

  if (!existsSync(E2E_SEED_STATE_PATH)) return null
  try {
    const raw = JSON.parse(
      readFileSync(E2E_SEED_STATE_PATH, 'utf8'),
    ) as Partial<E2eSeedState>
    if (!raw.propertyId) return null
    return {
      email: raw.email ?? 'test@example.com',
      organizationId: raw.organizationId ?? '',
      propertyId: raw.propertyId,
      propertyName: raw.propertyName ?? 'E2E Seed Property',
      propertySlug: raw.propertySlug ?? 'e2e-seed-property',
    }
  } catch {
    return null
  }
}

export function requireE2eSeedState(): E2eSeedState {
  const state = readE2eSeedState()
  if (!state?.propertyId) {
    throw new Error(
      `E2E seed state missing (expected ${E2E_SEED_STATE_PATH} or E2E_TEST_PROPERTY_ID). ` +
        `Run: pnpm exec tsx scripts/seed-e2e-user.ts`,
    )
  }
  return state
}
