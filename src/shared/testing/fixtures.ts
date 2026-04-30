// Shared test fixtures — builders for common test types.
// Per patterns.md: deterministic builders so tests don't depend on random state.

import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId,
  userId,
  propertyId,
  teamId,
  staffAssignmentId,
} from '#/shared/domain/ids'
import type { Property } from '#/contexts/property/domain/types'
import type { Team } from '#/contexts/team/domain/types'
import type { StaffAssignment } from '#/contexts/staff/domain/types'
import type { Portal, PortalLinkCategory, PortalLink } from '#/contexts/portal/domain/types'
import { portalId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'

/** Build a deterministic AuthContext for tests. */
export function buildTestAuthContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: userId('user-00000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    role: 'PropertyManager',
    ...overrides,
  }
}

/**
 * Generate a deterministic UUID from a short label.
 * Produces only valid hex chars (0-9, a-f) in UUID format so Postgres
 * uuid columns accept the value.
 *
 * e.g. uuidFromLabel('prop-a') → '1c34beef-0000-0000-0000-000000000000'
 */
function uuidFromLabel(label: string): string {
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8)
  return `${hex}-0000-0000-0000-000000000000`
}

/**
 * Resolve a test ID string to a DB-safe UUID.
 * If the string is already a valid hex UUID, pass through.
 * Otherwise, hash it to produce a deterministic UUID.
 */
function toTestId(rawId: string): string {
  // Quick check: 36 chars, hyphens at 8/13/18/23, all hex otherwise
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    rawId,
  )
  return isUuid ? rawId : uuidFromLabel(rawId)
}

/** Build a deterministic Property for tests. */
export function buildTestProperty(
  overrides: Partial<Omit<Property, 'id'>> & { id?: string } = {},
): Property {
  const idStr = overrides.id
    ? toTestId(overrides.id)
    : 'a0000000-0000-0000-0000-000000000001'
  const id = propertyId(idStr)
  const { id: _ignored, ...rest } = overrides
  return {
    id,
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    name: 'Test Property',
    slug: 'test-property',
    timezone: 'UTC',
    gbpPlaceId: null,
    createdAt: new Date('2026-04-10T12:00:00Z'),
    updatedAt: new Date('2026-04-10T12:00:00Z'),
    deletedAt: null,
    ...rest,
  } as Property
}

/** Build a deterministic Team for tests. */
export function buildTestTeam(
  overrides: Partial<Omit<Team, 'id'>> & { id?: string } = {},
): Team {
  const idStr = overrides.id
    ? toTestId(overrides.id)
    : 'b0000000-0000-0000-0000-000000000001'
  const resolvedId = teamId(idStr)
  const { id: _ignored, ...rest } = overrides
  return {
    id: resolvedId,
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    name: 'Test Team',
    description: null,
    teamLeadId: null,
    createdAt: new Date('2026-04-15T12:00:00Z'),
    updatedAt: new Date('2026-04-15T12:00:00Z'),
    deletedAt: null,
    ...rest,
  } as Team
}

/** Build a deterministic StaffAssignment for tests. */
export function buildTestStaffAssignment(
  overrides: Partial<Omit<StaffAssignment, 'id'>> & { id?: string } = {},
): StaffAssignment {
  const idStr = overrides.id
    ? toTestId(overrides.id)
    : 'c0000000-0000-0000-0000-000000000001'
  const resolvedId = staffAssignmentId(idStr)
  const { id: _ignored, ...rest } = overrides
  return {
    id: resolvedId,
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    userId: userId('user-00000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    teamId: null,
    createdAt: new Date('2026-04-15T12:00:00Z'),
    updatedAt: new Date('2026-04-15T12:00:00Z'),
    deletedAt: null,
    ...rest,
  } as StaffAssignment
}

/** Build a deterministic Portal for tests. */
export function buildTestPortal(
  overrides: Partial<Omit<Portal, 'id'>> & { id?: string } = {},
): Portal {
  const idStr = overrides.id
    ? toTestId(overrides.id)
    : 'd0000000-0000-0000-0000-000000000001'
  const id = portalId(idStr)
  const { id: _ignored, ...rest } = overrides
  return {
    id,
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    entityType: 'property',
    entityId: 'a0000000-0000-0000-0000-000000000001',
    name: 'Test Portal',
    slug: 'test-portal',
    description: null,
    heroImageUrl: null,
    theme: { primaryColor: '#6366F1' },
    smartRoutingEnabled: false,
    smartRoutingThreshold: 4,
    isActive: true,
    createdAt: new Date('2026-04-10T12:00:00Z'),
    updatedAt: new Date('2026-04-10T12:00:00Z'),
    deletedAt: null,
    ...rest,
  } as Portal
}

/** Build a deterministic PortalLinkCategory for tests. */
export function buildTestPortalLinkCategory(
  overrides: Partial<PortalLinkCategory> = {},
): PortalLinkCategory {
  return {
    id: portalLinkCategoryId('c0000000-0000-0000-0000-000000000001'),
    portalId: portalId('d0000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    title: 'Test Category',
    sortKey: 'a0',
    createdAt: new Date('2026-04-10T12:00:00Z'),
    updatedAt: new Date('2026-04-10T12:00:00Z'),
    ...overrides,
  }
}

/** Build a deterministic PortalLink for tests. */
export function buildTestPortalLink(
  overrides: Partial<PortalLink> = {},
): PortalLink {
  return {
    id: portalLinkId('10000000-0000-0000-0000-000000000001'),
    categoryId: portalLinkCategoryId('c0000000-0000-0000-0000-000000000001'),
    portalId: portalId('d0000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    label: 'Test Link',
    url: 'https://example.com',
    iconKey: null,
    sortKey: 'a0',
    createdAt: new Date('2026-04-10T12:00:00Z'),
    updatedAt: new Date('2026-04-10T12:00:00Z'),
    ...overrides,
  }
}
