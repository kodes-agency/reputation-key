// Shared E2E seed state written by scripts/seed-e2e-user.ts.
// Critical specs prefer this over UI-driven discovery (no /properties/new; list
// row clicks are client-side and flaky under Playwright hydration).

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type E2eSeedState = Readonly<{
  version: 'beta-local-1'
  email: string
  password: string
  staffEmail: string
  staffPassword: string
  managerName: string
  staffName: string
  candidateAName: string
  candidateBName: string
  candidateAParticipationId: string
  candidateBParticipationId: string
  organizationId: string
  managerUserId: string
  organizationName: string
  lockedOrganizationId: string
  propertyId: string
  onePropertyManagerEmail: string
  zeroPropertyManagerEmail: string
  boundedManagerPassword: string
  propertyName: string
  propertySlug: string
  p1PropertyId: string
  p2PropertyId: string
  p3PropertyId: string
  boundedPropertyIds: readonly string[]
  portalId: string
  portalToken: string
  p2PortalId: string
  p2PortalToken: string
  p3PortalId: string
  p3PortalToken: string
  portalGroupId: string
  emailQueueFixtureIds: readonly string[]
  portalLinkId: string
  teamId: string
  managerParticipationId: string
  staffParticipationId: string
  goalId: string
  badgeDefinitionId: string
  reviewCount: 100
}>

/** Path relative to repo root (CI cwd and local playwright cwd). */
export const E2E_SEED_STATE_PATH = resolve(process.cwd(), 'e2e/.seed-state.json')

export function readE2eSeedState(): E2eSeedState | null {
  if (!existsSync(E2E_SEED_STATE_PATH)) return null
  try {
    const raw = JSON.parse(
      readFileSync(E2E_SEED_STATE_PATH, 'utf8'),
    ) as Partial<E2eSeedState>
    const requiredStrings = [
      'email',
      'password',
      'staffEmail',
      'staffPassword',
      'managerName',
      'staffName',
      'candidateAName',
      'candidateBName',
      'candidateAParticipationId',
      'candidateBParticipationId',
      'organizationId',
      'managerUserId',
      'organizationName',
      'lockedOrganizationId',
      'propertyId',
      'propertyName',
      'propertySlug',
      'onePropertyManagerEmail',
      'zeroPropertyManagerEmail',
      'boundedManagerPassword',
      'p1PropertyId',
      'p2PropertyId',
      'p3PropertyId',
      'portalId',
      'portalToken',
      'p2PortalId',
      'p2PortalToken',
      'p3PortalId',
      'p3PortalToken',
      'portalGroupId',
      'portalLinkId',
      'teamId',
      'managerParticipationId',
      'staffParticipationId',
      'goalId',
      'badgeDefinitionId',
    ] as const
    if (
      raw.version !== 'beta-local-1' ||
      raw.reviewCount !== 100 ||
      !Array.isArray(raw.boundedPropertyIds) ||
      raw.boundedPropertyIds.length !== 7 ||
      !raw.boundedPropertyIds.every(
        (propertyId) => typeof propertyId === 'string' && propertyId.length > 0,
      ) ||
      !Array.isArray(raw.emailQueueFixtureIds) ||
      raw.emailQueueFixtureIds.length !== 3 ||
      !raw.emailQueueFixtureIds.every(
        (fixtureId) => typeof fixtureId === 'string' && fixtureId.length > 0,
      ) ||
      requiredStrings.some(
        (field) => typeof raw[field] !== 'string' || raw[field].length === 0,
      )
    ) {
      return null
    }
    return raw as E2eSeedState
  } catch {
    return null
  }
}

export function requireE2eSeedState(): E2eSeedState {
  const state = readE2eSeedState()
  if (!state?.propertyId) {
    throw new Error(
      `E2E seed state missing or invalid (expected ${E2E_SEED_STATE_PATH}). ` +
        `Run the local stack seed or: pnpm exec tsx scripts/seed-e2e-user.ts`,
    )
  }
  return state
}
