// Portal context — getPortalPreview use case tests
import { describe, expect, it } from 'vitest'
import { getPortalPreview } from './get-portal-preview'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import {
  organizationId,
  portalApprovedDestinationId,
  portalId,
  propertyId,
  userId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalApprovedDestination } from '../../domain/approved-destination'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS } from '../approved-destination-age'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import { immersiveSnapshot } from '../__fixtures__/immersive-snapshot'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL = portalId('d0000000-0000-0000-0000-000000000001')
const AT = new Date('2026-10-01T10:00:00Z')
const APPROVED_ID = '20000000-0000-0000-0000-000000000001'
const PENDING_ID = '20000000-0000-0000-0000-000000000002'
const APPROVED_URL = 'https://avela.bg/menu'
const PENDING_URL = 'https://pending.example.test/secret-path'

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const destination = (
  id: string,
  uri: string,
  approvalState: PortalApprovedDestination['approvalState'],
): PortalApprovedDestination => ({
  id: portalApprovedDestinationId(id),
  organizationId: ORG,
  propertyId: PROPERTY,
  normalizedUri: uri,
  hostname: new URL(uri).hostname,
  sourceType: 'custom',
  approvalState,
  validationVersion: 'portal-destination-https-v1',
  requestedBy: userId('user-1'),
  approvedBy: approvalState === 'approved' ? userId('admin-1') : null,
  approvedAt: approvalState === 'approved' ? AT : null,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: AT,
  createdAt: AT,
  updatedAt: AT,
})

type Options = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  active?: PortalPublicationSnapshot | null
  approvedUris?: readonly string[]
  timeZone?: string | null
}>

function setup(options: Options = {}) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([
    buildTestPortal({
      name: 'Pool & Terrace',
      additionalGuestLocales: ['bg'],
      privateFeedbackThreshold: 2,
    }),
  ])
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const category = buildTestPortalLinkCategory({})
  portalLinkRepo.seedCategories([category])
  portalLinkRepo.seedLinks([
    buildTestPortalLink({
      id: '10000000-0000-0000-0000-0000000000a1' as never,
      categoryId: category.id,
      destinationId: portalApprovedDestinationId(APPROVED_ID),
      url: APPROVED_URL,
      label: 'Menu',
      sortKey: 'a0',
    }),
    buildTestPortalLink({
      id: '10000000-0000-0000-0000-0000000000a2' as never,
      categoryId: category.id,
      destinationId: portalApprovedDestinationId(PENDING_ID),
      url: PENDING_URL,
      label: 'Spa',
      sortKey: 'a1',
    }),
  ])
  const queried: string[][] = []
  const validatedAfter: Date[] = []
  const useCase = getPortalPreview({
    portalRepo,
    portalLinkRepo,
    mediaRepo: { listServableIds: async () => [] },
    experienceRepo: {
      getPropertyExperience: async () => ({
        profile: null,
        content: [
          {
            id: 'content-en',
            organizationId: ORG,
            propertyId: PROPERTY,
            locale: 'en',
            title: 'Avela Resort',
            shortDescription: 'Rate your visit.',
            heroAltText: null,
            version: 1,
            updatedBy: userId('user-1'),
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      }),
      listPortalOverrides: async () => [],
    } as unknown as PortalExperienceRepository,
    destinationRepo: {
      list: async () => [
        destination(APPROVED_ID, APPROVED_URL, 'approved'),
        destination(PENDING_ID, PENDING_URL, 'pending'),
      ],
      listApprovedUris: async (_org, _property, uris, after) => {
        queried.push([...uris])
        validatedAfter.push(after)
        return uris.filter((uri) => (options.approvedUris ?? []).includes(uri))
      },
    },
    publicationRepo: { findActiveForPortal: async () => options.active ?? null },
    propertyFacts: {
      getPropertyTimezone: async () =>
        options.timeZone === undefined ? 'Europe/Sofia' : options.timeZone,
    },
    staffPublicApi: staffApi(options.accessible ?? null),
    clock: () => AT,
  })
  return { useCase, queried, validatedAfter }
}

const manager = () => buildTestAuthContext({ role: 'PropertyManager' })

describe('getPortalPreview (draft)', () => {
  it('describes the working copy in every language of the portal', async () => {
    const { useCase } = setup()

    const outcome = await useCase({ portalId: PORTAL, source: 'draft' }, manager())

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(outcome.preview).toMatchObject({
      source: 'draft',
      portalId: PORTAL,
      locales: ['en', 'bg'],
      privateFeedbackThreshold: 2,
    })
    expect(outcome.preview.experiences.en?.timeZone).toBe('Europe/Sofia')
    expect(outcome.preview.experiences.en?.content.title.value).toBe('Avela Resort')
  })

  it('shows a tile whose address is not approved as a placeholder', async () => {
    const { useCase } = setup()

    const outcome = await useCase({ portalId: PORTAL, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.links.map((link) => link.state)).toEqual([
      'ready',
      'awaiting_approval',
    ])
  })

  it('never includes an address that is not approved, or any other address', async () => {
    const { useCase } = setup()

    const outcome = await useCase({ portalId: PORTAL, source: 'draft' }, manager())

    const json = JSON.stringify(outcome)
    expect(json).not.toContain('pending.example.test')
    expect(json).not.toContain('secret-path')
    expect(json).not.toContain(APPROVED_URL)
  })

  it('reads the time zone as UTC when the Property has none on record', async () => {
    const { useCase } = setup({ timeZone: null })

    const outcome = await useCase({ portalId: PORTAL, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.timeZone).toBe('UTC')
  })
})

describe('getPortalPreview (live)', () => {
  const live = () => immersiveSnapshot()
  const published = ['https://harbor.example.com/menu', 'https://harbor.example.com/spa']

  it('presents the version guests can open now', async () => {
    const { useCase } = setup({ active: live(), approvedUris: published })

    const outcome = await useCase({ portalId: PORTAL, source: 'live' }, manager())

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(outcome.preview).toMatchObject({ source: 'live', version: 6 })
  })

  it('asks which of the published addresses are still approved, as the guest page does', async () => {
    const { useCase, queried } = setup({
      active: live(),
      approvedUris: ['https://harbor.example.com/menu'],
    })

    const outcome = await useCase({ portalId: PORTAL, source: 'live' }, manager())

    expect(queried).toEqual([published])
    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.links).toHaveLength(1)
  })

  it('applies the guest edge approval cut-off to the addresses', async () => {
    const { useCase, validatedAfter } = setup({ active: live(), approvedUris: published })

    await useCase({ portalId: PORTAL, source: 'live' }, manager())

    expect(validatedAfter).toEqual([
      new Date(AT.getTime() - APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS),
    ])
    expect(APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS).toBe(30 * 60 * 1_000)
  })

  it('says so when nothing is published', async () => {
    const { useCase } = setup({ active: null })

    expect(await useCase({ portalId: PORTAL, source: 'live' }, manager())).toEqual({
      status: 'unavailable',
      source: 'live',
      reason: 'not_published',
    })
  })

  it('says so when the live version predates the new page design', async () => {
    const legacy = {
      ...live(),
      configuration: { ...live().configuration, schemaVersion: 2 },
    } as unknown as PortalPublicationSnapshot
    const { useCase } = setup({ active: legacy })

    expect(await useCase({ portalId: PORTAL, source: 'live' }, manager())).toEqual({
      status: 'unavailable',
      source: 'live',
      reason: 'earlier_design',
    })
  })
})

describe('getPortalPreview (access)', () => {
  it('refuses a caller who holds no Portal read permission', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        { portalId: PORTAL, source: 'draft' },
        buildTestAuthContext({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { useCase } = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })

    await expect(
      useCase({ portalId: PORTAL, source: 'draft' }, manager()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        { portalId: PORTAL, source: 'draft' },
        buildTestAuthContext({
          role: 'PropertyManager',
          organizationId: organizationId('org-00000000-0000-0000-0000-0000000000aa'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
