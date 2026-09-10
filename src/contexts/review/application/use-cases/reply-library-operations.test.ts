import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyTemplateRepository,
} from '../ports/reply-template.repository'
import {
  getPropertyReplyLibrary,
  savePropertyReplyProfile,
  savePropertyReplyTemplate,
  setPropertyReplyTemplateEnabled,
} from './reply-library-operations'

const ORGANIZATION = organizationId('73000000-0000-4000-8000-000000000001')
const PROPERTY = propertyId('73000000-0000-4000-8000-000000000002')
const OTHER_PROPERTY = propertyId('73000000-0000-4000-8000-000000000003')
const USER = userId('73000000-0000-4000-8000-000000000004')
const NOW = new Date('2026-09-10T12:00:00.000Z')

const MANAGER: AuthContext = {
  organizationId: ORGANIZATION,
  userId: USER,
  role: 'PropertyManager',
}

function profile(): PropertyReplyProfile {
  return {
    id: '73000000-0000-4000-8000-000000000005',
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    greeting: 'Dear {guest_name},',
    signOffPositive: 'Warm regards',
    signOffNegative: 'Sincerely',
    emojiAllowed: false,
    escalationContact: 'care@example.test',
    version: 1,
    updatedBy: USER,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function template(overrides: Partial<PropertyReplyTemplate> = {}): PropertyReplyTemplate {
  return {
    id: '73000000-0000-4000-8000-000000000006',
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    title: 'General positive',
    ratingMin: 4,
    ratingMax: 5,
    hasText: true,
    aspect: null,
    openLabel: null,
    languageTag: 'en-Latn',
    body: 'Thank you, {guest_name}.',
    enabled: true,
    version: 1,
    updatedBy: USER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function staffApi(accessible: readonly string[] = [PROPERTY]): StaffPublicApi {
  return {
    getAccessiblePropertyIds: vi.fn(async () => accessible.map(propertyId)),
    getAssignedPortals: vi.fn(async () => []),
  }
}

function repository() {
  const storedProfile = profile()
  const storedTemplate = template()
  return {
    findPropertyOrganization: vi.fn(async () => ORGANIZATION),
    findProfile: vi.fn(async () => storedProfile),
    findApplicableTemplates: vi.fn(async () => [storedTemplate]),
    listPropertyTemplates: vi.fn(async () => [
      storedTemplate,
      template({
        id: '73000000-0000-4000-8000-000000000007',
        title: 'Paused recovery',
        enabled: false,
      }),
    ]),
    findEnabledTemplateById: vi.fn(async () => storedTemplate),
    readDefaultReplyLanguage: vi.fn(async () => 'en-Latn-US'),
    upsertProfile: vi.fn(async () => ({
      disposition: 'updated' as const,
      value: { ...storedProfile, version: 2 },
    })),
    upsertTemplate: vi.fn(async () => ({
      disposition: 'inserted' as const,
      value: storedTemplate,
    })),
    updateTemplate: vi.fn(async (input) => ({
      disposition: 'updated' as const,
      value: {
        ...storedTemplate,
        ...input,
        id: input.templateId,
        version: 2,
      },
    })),
    setTemplateEnabled: vi.fn(async (input) => ({
      disposition: 'updated' as const,
      value: {
        ...storedTemplate,
        enabled: input.enabled,
        updatedBy: input.updatedBy,
        version: 2,
      },
    })),
  } satisfies ReplyTemplateRepository
}

const PROFILE_INPUT = {
  greeting: 'Hello {guest_name},',
  signOffPositive: 'With appreciation',
  signOffNegative: 'Guest relations',
  emojiAllowed: true,
  escalationContact: null,
}

const TEMPLATE_INPUT = {
  title: 'Renamed positive',
  ratingMin: 4,
  ratingMax: 5,
  hasText: true,
  aspect: 'service' as const,
  openLabel: null,
  languageTag: 'en-Latn',
  body: 'Thank you for mentioning {staff_name}.',
  enabled: true,
}

describe('property reply library operations', () => {
  it('reads the profile and every enabled and disabled template', async () => {
    const repo = repository()

    const result = await getPropertyReplyLibrary({
      repository: repo,
      staffPublicApi: staffApi(),
    })({ propertyId: PROPERTY }, MANAGER)

    expect(repo.listPropertyTemplates).toHaveBeenCalledWith(ORGANIZATION, PROPERTY)
    expect(result).toMatchObject({
      profile: { greeting: 'Dear {guest_name},', version: 1 },
      defaultLanguageTag: 'en-Latn-US',
      templates: [
        { title: 'General positive', enabled: true },
        { title: 'Paused recovery', enabled: false },
      ],
    })
  })

  it('writes profile and template changes with the current user attribution', async () => {
    const repo = repository()
    const deps = { repository: repo, staffPublicApi: staffApi() }

    await savePropertyReplyProfile(deps)(
      { propertyId: PROPERTY, profile: PROFILE_INPUT },
      MANAGER,
    )
    await savePropertyReplyTemplate(deps)(
      {
        propertyId: PROPERTY,
        templateId: '73000000-0000-4000-8000-000000000006',
        template: TEMPLATE_INPUT,
      },
      MANAGER,
    )

    expect(repo.upsertProfile).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      ...PROFILE_INPUT,
      updatedBy: USER,
    })
    expect(repo.updateTemplate).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      templateId: '73000000-0000-4000-8000-000000000006',
      ...TEMPLATE_INPUT,
      updatedBy: USER,
    })
    expect(repo.upsertTemplate).not.toHaveBeenCalled()
  })

  it('creates without an id and toggles an existing template through id-keyed updates', async () => {
    const repo = repository()
    const deps = { repository: repo, staffPublicApi: staffApi() }

    await savePropertyReplyTemplate(deps)(
      { propertyId: PROPERTY, template: TEMPLATE_INPUT },
      MANAGER,
    )
    await setPropertyReplyTemplateEnabled(deps)(
      {
        propertyId: PROPERTY,
        templateId: '73000000-0000-4000-8000-000000000006',
        enabled: false,
      },
      MANAGER,
    )

    expect(repo.upsertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed positive', updatedBy: USER }),
    )
    expect(repo.setTemplateEnabled).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      templateId: '73000000-0000-4000-8000-000000000006',
      enabled: false,
      updatedBy: USER,
    })
  })

  it('refuses Members before reading property data', async () => {
    const repo = repository()

    await expect(
      getPropertyReplyLibrary({ repository: repo, staffPublicApi: staffApi() })(
        { propertyId: PROPERTY },
        { ...MANAGER, role: 'Member' },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(repo.findPropertyOrganization).not.toHaveBeenCalled()
  })

  it('refuses an assigned-scope manager outside their property grant', async () => {
    const repo = repository()

    await expect(
      getPropertyReplyLibrary({
        repository: repo,
        staffPublicApi: staffApi([OTHER_PROPERTY]),
      })({ propertyId: PROPERTY }, MANAGER),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(repo.findPropertyOrganization).not.toHaveBeenCalled()
  })
})
