// Portal context — go-live and archive server functions over PostgreSQL.
// The real createServerFn handlers run over the real scope lookups, intents and
// command store. The session, the execution policy, the Property lifecycle and
// the Google destination are other contexts' answers, so they are stood in for;
// each refusal is asserted on the Portal row it leaves.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { policyDenial } from '#/shared/testing/policy-denial'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { createAtomicPortalCommandStore } from '../publication/portal-command-store.server'
import {
  archivePortal as archivePortalIntent,
  publishPortal as publishPortalIntent,
} from '../publication/portal-intents.server'
import { createPortalPublicationRepository } from '../infrastructure/repositories/portal-publication.repository'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalScopeRepository } from '../infrastructure/repositories/portal-scope.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import {
  PORTAL_CREATION_TABLES,
  VERIFIED_GOOGLE_DESTINATION,
  seedCreationPortal,
  seedCreationProperty,
  seedCreationToken,
} from '../infrastructure/testing/portal-creation-world'

const handlerWorld = vi.hoisted(() => ({
  actor: undefined as unknown,
  requireExecutionAllowed: vi.fn(),
  management: (): unknown => undefined,
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(async () => handlerWorld.actor),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: handlerWorld.requireExecutionAllowed,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => new Date('2026-10-01T12:00:00.000Z'),
    portalPublicApi: { management: handlerWorld.management() },
  }),
}))

import { archivePortal, publishPortal } from './portals'

const ORG_A = organizationId('org-prtlhandler-0000-0000-000000000001')
const ORG_B = organizationId('org-prtlhandler-0000-0000-000000000002')
const PROPERTY = propertyId('c3c10000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('c3c10000-0000-4000-8000-00000000000b')
const PORTAL = 'c3c20000-0000-4000-8000-000000000001'
const PORTAL_B = 'c3c20000-0000-4000-8000-0000000000b1'
const CLOCK = new Date('2026-10-01T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'goal_subject_assignments',
    'goal_program_versions',
    'goal_programs',
    ...PORTAL_CREATION_TABLES,
  ],
})

handlerWorld.management = () => {
  const db = getDb()
  const guard = createPortalRatingGoalGuard()
  const deps = {
    ratingGoalGuard: {
      findRunningRatingGoalBlock: (org: string, property: string, portal: string) =>
        db.transaction((tx) =>
          guard.findPortalRatingGoalBlockInTransaction(tx, {
            organizationId: org as never,
            propertyId: property as never,
            portalId: portal as never,
            at: CLOCK,
          }),
        ),
    },
    portalRepo: createPortalRepository(db),
    commandStore: createAtomicPortalCommandStore(db, guard),
    publicationRepo: createPortalPublicationRepository(db),
    portalTokenRepo: createPortalTokenRepository(db),
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => VERIFIED_GOOGLE_DESTINATION,
    },
    propertyLifecycleApi: { isPropertyActive: async () => true },
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    idGen: randomUUID,
    clock: () => CLOCK,
  }
  return {
    resolvePortalManagementScope: createPortalScopeRepository(db).resolvePortal,
    publishPortal: publishPortalIntent(deps),
    archivePortal: archivePortalIntent(deps),
  }
}

const portalRow = async (id = PORTAL) =>
  (
    await getPool().query<{ publication_state: string; deleted_at: Date | null }>(
      `SELECT publication_state, deleted_at FROM portals WHERE id = $1`,
      [id],
    )
  ).rows[0]

const seedPortal = async (
  org: typeof ORG_A | typeof ORG_B,
  property: typeof PROPERTY,
  id: string,
  slug: string,
) => {
  await seedCreationProperty(getPool(), { organizationId: org, propertyId: property })
  const scope = { organizationId: org, propertyId: property, portalId: id }
  await seedCreationPortal(getPool(), {
    ...scope,
    slug,
    name: 'Test Portal',
    publicationState: 'draft',
  })
  await seedCreationToken({
    ...scope,
    tokenId: `c3c70000-0000-4000-8000-${id.slice(-12)}`,
    identifier: `handler-${id.slice(-12)}`,
  })
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  handlerWorld.actor = buildTestAuthContext({
    organizationId: ORG_A,
    userId: userId('admin-portals-handler'),
    role: 'AccountAdmin',
  })
  handlerWorld.requireExecutionAllowed.mockReset()
  handlerWorld.requireExecutionAllowed.mockResolvedValue(undefined)
  await seedPortal(ORG_A, PROPERTY, PORTAL, 'handler-portal')
  await seedPortal(ORG_B, PROPERTY_B, PORTAL_B, 'handler-portal-b')
})

describe('publishPortal server function (real PostgreSQL)', () => {
  it('refuses go-live without a reviewed digest and leaves the Portal a draft', async () => {
    const response = await withStartContext(() =>
      publishPortal.__executeServer({ method: 'POST', data: { portalId: PORTAL } }),
    )

    expect(response).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('"reviewedDigest"'),
      }),
    })
    expect(await portalRow()).toMatchObject({ publication_state: 'draft' })
  })

  it('leaves the Portal a draft when the policy refuses the Property', async () => {
    handlerWorld.requireExecutionAllowed.mockRejectedValue(
      policyDenial('property_not_allowlisted'),
    )

    await expect(
      withStartContext(() =>
        publishPortal({ data: { portalId: PORTAL, reviewedDigest: 'reviewed-digest' } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_allowlisted', status: 403 })

    expect(await portalRow()).toMatchObject({ publication_state: 'draft' })
  })

  it("answers not found for another organization's Portal and leaves it untouched", async () => {
    await expect(
      withStartContext(() =>
        publishPortal({
          data: { portalId: PORTAL_B, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 })

    expect(await portalRow(PORTAL_B)).toMatchObject({ publication_state: 'draft' })
    expect(handlerWorld.requireExecutionAllowed).not.toHaveBeenCalled()
  })
})

describe('archivePortal server function (real PostgreSQL)', () => {
  it('archives the Portal recoverably: its state is archived and the row is not deleted', async () => {
    await withStartContext(() => archivePortal({ data: { portalId: PORTAL } }))

    expect(await portalRow()).toEqual({ publication_state: 'archived', deleted_at: null })
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PROPERTY }),
    )
  })

  it('leaves the Portal as it was when the policy refuses the Property', async () => {
    handlerWorld.requireExecutionAllowed.mockRejectedValue(
      policyDenial('property_not_allowlisted'),
    )

    await expect(
      withStartContext(() => archivePortal({ data: { portalId: PORTAL } })),
    ).rejects.toMatchObject({ code: 'property_not_allowlisted', status: 403 })

    expect(await portalRow()).toEqual({ publication_state: 'draft', deleted_at: null })
  })
})
