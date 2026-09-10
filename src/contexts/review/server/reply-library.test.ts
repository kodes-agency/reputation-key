import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'

type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const PROPERTY = '74000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '74000000-0000-4000-8000-000000000002'
const ORGANIZATION = organizationId('74000000-0000-4000-8000-000000000003')
const ACTOR: AuthContext = {
  organizationId: ORGANIZATION,
  userId: userId('74000000-0000-4000-8000-000000000004'),
  role: 'PropertyManager',
}

const mocks = vi.hoisted(() => ({
  getPropertyLibrary: vi.fn(),
  savePropertyProfile: vi.fn(),
  savePropertyTemplate: vi.fn(),
  setPropertyTemplateEnabled: vi.fn(),
  headersFromContext: vi.fn(),
  resolveTenantContext: vi.fn(),
  listAccessiblePropertyIds: vi.fn(),
}))
const seam = vi.hoisted(() => ({ methods: [] as string[] }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    seam.methods.push(options?.method ?? 'GET')
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        return async (opts: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(opts.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    reviewPublicApi: {
      reply: {
        getPropertyLibrary: mocks.getPropertyLibrary,
        savePropertyProfile: mocks.savePropertyProfile,
        savePropertyTemplate: mocks.savePropertyTemplate,
        setPropertyTemplateEnabled: mocks.setPropertyTemplateEnabled,
      },
    },
  }),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))

import {
  getPropertyReplyLibraryFn,
  savePropertyReplyProfileFn,
  savePropertyReplyTemplateFn,
  setPropertyReplyTemplateEnabledFn,
} from './reply-library'

const PROFILE = {
  greeting: 'Dear {guest_name},',
  signOffPositive: 'Warm regards',
  signOffNegative: 'Sincerely',
  emojiAllowed: false,
  escalationContact: null,
}
const TEMPLATE = {
  title: 'General positive',
  ratingMin: 4,
  ratingMax: 5,
  hasText: true,
  aspect: null,
  openLabel: null,
  languageTag: 'en-Latn',
  body: 'Thank you, {guest_name}.',
  enabled: true,
}

const callUnchecked = (fn: (input: { data: never }) => Promise<unknown>, data: unknown) =>
  fn({ data } as { data: never })

beforeEach(() => {
  vi.clearAllMocks()
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(
    createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: ORGANIZATION }),
  )
  mocks.listAccessiblePropertyIds.mockResolvedValue([PROPERTY])
  initExecutionPolicy(
    createExecutionPolicy({
      listAccessiblePropertyIds: mocks.listAccessiblePropertyIds,
    }),
  )
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.getPropertyLibrary.mockResolvedValue({
    profile: null,
    templates: [],
    defaultLanguageTag: 'en-Latn-US',
  })
  mocks.savePropertyProfile.mockResolvedValue({ disposition: 'updated', value: PROFILE })
  mocks.savePropertyTemplate.mockResolvedValue({
    disposition: 'updated',
    value: TEMPLATE,
  })
  mocks.setPropertyTemplateEnabled.mockResolvedValue({
    disposition: 'updated',
    value: { ...TEMPLATE, enabled: false },
  })
})

afterEach(() => {
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('reply-library server functions', () => {
  it('declares one read and three mutation contracts', () => {
    expect(seam.methods.slice(-4)).toEqual(['GET', 'POST', 'POST', 'POST'])
  })

  it('validates and forwards every property-scoped contract', async () => {
    const read = await getPropertyReplyLibraryFn({ data: { propertyId: PROPERTY } })
    await savePropertyReplyProfileFn({
      data: { propertyId: PROPERTY, profile: PROFILE },
    })
    await savePropertyReplyTemplateFn({
      data: { propertyId: PROPERTY, template: TEMPLATE },
    })
    await setPropertyReplyTemplateEnabledFn({
      data: {
        propertyId: PROPERTY,
        templateId: '74000000-0000-4000-8000-000000000005',
        enabled: false,
      },
    })

    expect(read).toMatchObject({ templates: [], defaultLanguageTag: 'en-Latn-US' })
    expect(mocks.getPropertyLibrary).toHaveBeenCalledWith({ propertyId: PROPERTY }, ACTOR)
    expect(mocks.savePropertyProfile).toHaveBeenCalledWith(
      { propertyId: PROPERTY, profile: PROFILE },
      ACTOR,
    )
    expect(mocks.savePropertyTemplate).toHaveBeenCalledWith(
      { propertyId: PROPERTY, template: TEMPLATE },
      ACTOR,
    )
    expect(mocks.setPropertyTemplateEnabled).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY,
        templateId: '74000000-0000-4000-8000-000000000005',
        enabled: false,
      },
      ACTOR,
    )
    expect(mocks.listAccessiblePropertyIds).toHaveBeenCalledWith(
      ORGANIZATION,
      ACTOR.userId,
    )
  })

  it('rejects invalid input before resolving an actor', async () => {
    await expect(
      callUnchecked(getPropertyReplyLibraryFn, {
        propertyId: PROPERTY,
        unexpected: true,
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
    expect(mocks.getPropertyLibrary).not.toHaveBeenCalled()
  })

  it('refuses a Member without reply.manage at the server function', async () => {
    mocks.resolveTenantContext.mockResolvedValueOnce({ ...ACTOR, role: 'Member' })

    await expect(
      getPropertyReplyLibraryFn({ data: { propertyId: PROPERTY } }),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect(mocks.getPropertyLibrary).not.toHaveBeenCalled()
  })

  it('refuses an assigned-scope PropertyManager for a property they do not hold', async () => {
    mocks.listAccessiblePropertyIds.mockResolvedValueOnce([OTHER_PROPERTY])

    await expect(
      getPropertyReplyLibraryFn({ data: { propertyId: PROPERTY } }),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(mocks.getPropertyLibrary).not.toHaveBeenCalled()
  })
})
