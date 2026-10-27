// The saved wording of the final print kit over real PostgreSQL (2026-10-27): what
// "Save wording" stores, what the print kit read says of it, and whose Portal each
// of them reaches. The use cases are the real ones over the real repositories and
// the real Portal rows; the repository's own constraints are its own test's.

import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { getDb } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { savePortalPrintWordingInputSchema } from '../../application/dto/portal-print-wording.dto'
import { getPortalPrintKit } from '../../application/use-cases/get-portal-print-kit'
import { savePortalPrintWording } from '../../application/use-cases/save-portal-print-wording'
import { createPortalLastPrintRepository } from '../repositories/portal-last-print.repository'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPortalPrintWordingRepository } from '../repositories/portal-print-wording.repository'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'
import { createPortalRepository } from '../repositories/portal.repository'
import { seedLiveImmersiveSnapshot } from '../testing/portal-live-immersive-seed'
import { seedPortalWorkingCopy } from '../testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from '../testing/portal-working-copy-scenarios'
import {
  PRINT_KIT_INTEGRATION_TABLES,
  printKitLiveConfiguration,
} from './__fixtures__/print-kit-live-seed'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: PRINT_KIT_INTEGRATION_TABLES,
})

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const OWN = { en: { headline: 'Thanks for staying', subline: 'Tell us more' } }

async function harness() {
  await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
  await seedLiveImmersiveSnapshot({
    organizationId: COMPLETE_SCENARIO.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId,
    portalId: COMPLETE_SCENARIO.portalId,
    configuration: printKitLiveConfiguration(),
  })
  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const wordingRepo = createPortalPrintWordingRepository(db)
  return {
    save: savePortalPrintWording({
      portalRepo,
      staffPublicApi,
      wordingRepo,
      clock: () => new Date('2026-10-27T10:00:00Z'),
      finalKitEnabled: true,
    }),
    read: getPortalPrintKit({
      portalRepo,
      staffPublicApi,
      publicationRepo: createPortalPublicationRepository(db),
      mediaRepo: createPortalMediaAssetRepository(db),
      lastPrintRepo: createPortalLastPrintRepository(db),
      wordingRepo,
      finalKitEnabled: true,
    }),
    ctx: buildTestAuthContext({ organizationId: WORKING_COPY_ORG }),
  }
}

const parsed = (input: unknown) => savePortalPrintWordingInputSchema.parse(input)

const rows = async () =>
  (
    await getPool().query(
      'SELECT organization_id, call_to_action FROM portal_print_wordings',
    )
  ).rows

describe.sequential('Saved print wording (real PostgreSQL)', () => {
  it('says nothing of a wording until one is saved, then carries it in the print kit read', async () => {
    const { save, read, ctx } = await harness()
    const portalId = COMPLETE_SCENARIO.portalId
    expect((await read({ portalId }, ctx)).savedWording).toBeNull()

    await save(parsed({ portalId, callToAction: 'how_was_stay', customWords: OWN }), ctx)

    expect((await read({ portalId }, ctx)).savedWording).toEqual({
      callToAction: 'how_was_stay',
      customWords: OWN,
    })
    expect(await rows()).toEqual([
      { organization_id: WORKING_COPY_ORG, call_to_action: 'how_was_stay' },
    ])
  })

  it('keeps one row for the Portal: the next save replaces the last', async () => {
    const { save, read, ctx } = await harness()
    const portalId = COMPLETE_SCENARIO.portalId

    await save(parsed({ portalId, callToAction: 'how_was_stay', customWords: OWN }), ctx)
    await save(parsed({ portalId, callToAction: 'rate_visit' }), ctx)

    expect((await read({ portalId }, ctx)).savedWording).toEqual({
      callToAction: 'rate_visit',
      customWords: null,
    })
    expect(await rows()).toHaveLength(1)
  })

  it('does not reach a Portal of another Organization: nothing is saved and nothing is read', async () => {
    const { save, read } = await harness()
    const portalId = COMPLETE_SCENARIO.portalId
    const stranger = buildTestAuthContext({ organizationId: WORKING_COPY_OTHER_ORG })

    await expect(
      save(
        parsed({ portalId, callToAction: 'how_was_stay', customWords: OWN }),
        stranger,
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    await expect(read({ portalId }, stranger)).rejects.toMatchObject({
      code: 'portal_not_found',
    })

    expect(await rows()).toEqual([])
  })

  it('refuses a caller who may not update the Portal, and saves nothing', async () => {
    const { save, ctx } = await harness()
    const viewer = buildTestAuthContext({
      organizationId: ctx.organizationId,
      effectivePermissions: new Set(),
    })

    await expect(
      save(
        parsed({
          portalId: COMPLETE_SCENARIO.portalId,
          callToAction: 'how_was_stay',
          customWords: OWN,
        }),
        viewer,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(await rows()).toEqual([])
  })
})
