import { describe, expect, it, vi } from 'vitest'
import '#/shared/auth/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ReplyLibraryRepository } from '../ports/reply-library.repository'
import {
  getReplyLibrary,
  saveReplyTemplate,
  saveReplyVoice,
} from './reply-library-layer-operations'

const ORGANIZATION = organizationId('org-1')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const USER = userId('user-1')
const ADMIN: AuthContext = {
  organizationId: ORGANIZATION,
  userId: USER,
  role: 'AccountAdmin',
}
const MANAGER: AuthContext = { ...ADMIN, role: 'PropertyManager' }

function deps() {
  const repository: ReplyLibraryRepository = {
    loadSnapshot: vi.fn(async () => ({
      propertyName: 'Harbor House',
      defaultReplyLanguage: 'en-Latn-US',
      accountVoice: null,
      propertyVoice: null,
      accountTemplates: [],
      propertyTemplates: [],
      visibility: [],
    })),
    saveVoice: vi.fn(),
    saveTemplate: vi.fn(),
    setHidden: vi.fn(),
    archiveCustomization: vi.fn(),
  }
  const staffPublicApi = {
    getAccessiblePropertyIds: vi.fn(async () => [PROPERTY]),
    getAssignedPortals: vi.fn(async () => []),
  } as StaffPublicApi
  return { repository, staffPublicApi }
}

describe('reply library layer operations', () => {
  it('returns the built-in library and resolved default voice for an AccountAdmin', async () => {
    const result = await getReplyLibrary(deps())({ propertyId: PROPERTY }, ADMIN)
    expect(result.templates).toHaveLength(34)
    expect(result.templates.filter(({ essential }) => essential)).toHaveLength(9)
    expect(result.voice.useFirstName.value).toBe(true)
    expect(result.supportedLanguages).toContain('ar-Arab')
    expect(result.supportedLanguages).toContain('bg-Cyrl')
    expect(result.canManage).toBe(true)
  })

  it('lets a PropertyManager read the library and keeps changes AccountAdmin-only', async () => {
    const read = await getReplyLibrary(deps())({ propertyId: PROPERTY }, MANAGER)
    expect(read.canManage).toBe(false)
    await expect(
      saveReplyVoice(deps())(
        {
          propertyId: PROPERTY,
          scope: 'account',
          set: {},
          reset: [],
          expectedVersion: 0,
        },
        MANAGER,
      ),
    ).rejects.toMatchObject({
      code: 'unauthorized',
    })
  })

  it('returns a typed block-code refusal before saving an unsafe body', async () => {
    const dependencies = deps()
    await expect(
      saveReplyTemplate(dependencies)(
        {
          propertyId: PROPERTY,
          scope: 'account',
          title: 'Unsafe',
          starsMin: 5,
          starsMax: 5,
          reviewKind: 'text',
          topic: null,
          wordings: [
            { key: '1', languageGroup: 'en-Latn', body: 'Book now for 20% off.' },
          ],
        },
        ADMIN,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      context: { findingCodes: expect.arrayContaining(['offer_or_solicitation']) },
    })
    expect(dependencies.repository.saveTemplate).not.toHaveBeenCalled()
  })
})
