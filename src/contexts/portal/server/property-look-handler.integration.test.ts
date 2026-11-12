// Portal context — the Property look server function over PostgreSQL.
// The real createServerFn handler runs over the real use case and the real
// Brand Profile writer. The session and the execution policy are other
// contexts' answers, so they are stood in for; each save and each refusal is
// asserted on the stored profile.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { policyDenial } from '#/shared/testing/policy-denial'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { savePropertyLook as savePropertyLookUseCase } from '../application/use-cases/save-property-look'
import { createPortalExperienceRepository } from '../infrastructure/repositories/portal-experience.repository'

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
  getExecutionPolicy: vi.fn(),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: { management: handlerWorld.management() },
  }),
}))

import { savePropertyLook } from './property-look'

const ORG_A = organizationId('org-prop-look-hndlr-0000-000000000001')
const ORG_B = organizationId('org-prop-look-hndlr-0000-000000000002')
const PROPERTY = propertyId('7e300000-0000-4000-8000-000000000001')
const NOW = new Date('2026-10-01T10:00:00.000Z')
const LATER = new Date('2026-10-01T11:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_snapshots',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'outbox_events',
    'portals',
    'properties',
  ],
})

handlerWorld.management = () => ({
  savePropertyLook: savePropertyLookUseCase({
    experienceRepo: createPortalExperienceRepository(getDb()),
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    clock: () => LATER,
  }),
})

const profileRow = async () =>
  (
    await getPool().query(
      `SELECT primary_color, background_color, background_mode, wordmark, look_version
         FROM property_portal_brand_profiles
        WHERE organization_id = $1 AND property_id = $2`,
      [ORG_A, PROPERTY],
    )
  ).rows[0]

const SEEDED = {
  primary_color: '#2563EB',
  background_color: '#FFFFFF',
  background_mode: 'auto',
  wordmark: null,
  look_version: 3,
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  handlerWorld.actor = buildTestAuthContext({
    role: 'AccountAdmin',
    organizationId: ORG_A,
  })
  handlerWorld.requireExecutionAllowed.mockReset()
  handlerWorld.requireExecutionAllowed.mockResolvedValue(undefined)
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Avela Resort', 'avela-resort-hndlr', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, NOW],
  )
  await getPool().query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color, background_color,
        text_color, version, look_version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Avela Resort', '#2563EB', '#FFFFFF', '#111827', 5, 3,
             'seed-admin', $4, $4)`,
    [randomUUID(), ORG_A, PROPERTY, NOW],
  )
})

describe('savePropertyLook server function (real PostgreSQL)', () => {
  it('stores the look once the Property policy has been asked for portal.write', async () => {
    await withStartContext(() =>
      savePropertyLook({
        data: { propertyId: PROPERTY, accentColour: '#ead6a8', backgroundMode: 'auto' },
      }),
    )

    expect(await profileRow()).toMatchObject({
      primary_color: '#EAD6A8',
      look_version: 4,
    })
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: handlerWorld.actor,
        action: 'portal.update',
        capability: 'portal.write',
        propertyId: PROPERTY,
      }),
    )
  })

  it('carries a refused look out as a tagged Portal error and stores nothing', async () => {
    await expect(
      withStartContext(() =>
        savePropertyLook({
          data: {
            propertyId: PROPERTY,
            accentColour: '#EAD6A8',
            backgroundMode: 'manual',
            backgroundColour: '#E8E8E8',
          },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'invalid_theme' })

    expect(await profileRow()).toEqual(SEEDED)
  })

  it('stores nothing when the Property policy refuses', async () => {
    handlerWorld.requireExecutionAllowed.mockRejectedValue(
      policyDenial('capability_disabled'),
    )

    await expect(
      withStartContext(() =>
        savePropertyLook({
          data: { propertyId: PROPERTY, accentColour: '#ead6a8', backgroundMode: 'auto' },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await profileRow()).toEqual(SEEDED)
  })
})
