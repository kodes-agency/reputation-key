// Portal context — get portal use case tests

import { describe, it, expect, vi } from 'vitest'
import { getPortal } from './get-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import type {
  PortalTokenRepository,
  ResolvablePortalTokenSummary,
} from '../ports/portal-token.repository'

const NOW = new Date('2026-08-21T10:00:00.000Z')
const ISSUED_AT = new Date('2026-08-01T09:30:00.000Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (
  accessible: ReadonlyArray<PropertyId> | null = null,
  token: ResolvablePortalTokenSummary | null = null,
) => {
  const portalRepo = createInMemoryPortalRepo()
  const useCase = getPortal({
    portalRepo,
    portalTokenRepo: { findResolvableSummaryForPortal: async () => token },
    staffPublicApi: staffApiMock(accessible),
    clock: () => NOW,
  })
  return { useCase, portalRepo }
}

describe('getPortal', () => {
  it('returns a portal by id', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({ name: 'Found Portal' })
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.portal.name).toBe('Found Portal')
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(useCase({ portalId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects when portal belongs to another organization', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({
      organizationId:
        'org-00000000-0000-0000-0000-000000000002' as unknown as import('#/shared/domain/ids').OrganizationId,
    })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(useCase({ portalId: portal.id }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects when PropertyManager lacks assignment to portal property', async () => {
    const { useCase, portalRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(useCase({ portalId: portal.id }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  // C2: the Share tab can only offer rotate/revoke — the sole mitigations for a
  // leaked opaque token — if the read path reports that a live token exists.
  // Whether a token still resolves is decided by the repository predicate
  // shared with public token resolution, so a revoked token reaches this use
  // case as `null` exactly like a portal that never had one (see
  // portal-token.repository.test.ts for the state-by-state SQL coverage).
  it('reports no active token when nothing resolves for the portal', async () => {
    const { useCase, portalRepo } = setup(null, null)
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.tokenStatus).toEqual({
      hasActiveToken: false,
      qualifiedScanReady: false,
      version: null,
      issuedAt: null,
      graceExpiresAt: null,
    })
  })

  it('reports an active token as ISO metadata without any token material', async () => {
    const { useCase, portalRepo } = setup(null, {
      version: 3,
      issuedAt: ISSUED_AT,
      gracePeriodEnds: null,
      hasPublishedAccessArtifact: true,
    })
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.tokenStatus).toEqual({
      hasActiveToken: true,
      qualifiedScanReady: true,
      version: 3,
      issuedAt: ISSUED_AT.toISOString(),
      graceExpiresAt: null,
    })
    expect(Object.keys(result.tokenStatus).sort()).toEqual([
      'graceExpiresAt',
      'hasActiveToken',
      'issuedAt',
      'qualifiedScanReady',
      'version',
    ])
  })

  it('reports active while a rotated token is inside its grace window', async () => {
    const graceEnds = new Date(NOW.getTime() + 15 * 60_000)
    const { useCase, portalRepo } = setup(null, {
      version: 1,
      issuedAt: ISSUED_AT,
      gracePeriodEnds: graceEnds,
      hasPublishedAccessArtifact: false,
    })
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.tokenStatus).toEqual({
      hasActiveToken: true,
      qualifiedScanReady: false,
      version: 1,
      issuedAt: ISSUED_AT.toISOString(),
      graceExpiresAt: graceEnds.toISOString(),
    })
  })

  it('asks the repository for resolvability as of the injected clock', async () => {
    const findResolvableSummaryForPortal = vi.fn<
      PortalTokenRepository['findResolvableSummaryForPortal']
    >(async () => null)
    const portalRepo = createInMemoryPortalRepo()
    const useCase = getPortal({
      portalRepo,
      portalTokenRepo: { findResolvableSummaryForPortal },
      staffPublicApi: staffApiMock(null),
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    expect(findResolvableSummaryForPortal).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.id,
      NOW,
    )
  })
})
