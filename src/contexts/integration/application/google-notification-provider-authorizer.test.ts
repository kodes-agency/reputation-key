import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import type { GoogleConnection } from '../domain/types'
import type { GoogleReviewSyncAuthorizer } from './google-review-sync-authorizer'
import {
  createGoogleNotificationProviderAuthorizer,
  type NotificationBindingView,
} from './google-notification-provider-authorizer'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const CONN = googleConnectionId('e0000000-0000-0000-0000-000000000001')
const OTHER_CONN = googleConnectionId('e0000000-0000-0000-0000-000000000002')
const PROPERTY_A = '10000000-0000-4000-8000-00000000000a'
const PROPERTY_B = '10000000-0000-4000-8000-00000000000b'
const PROPERTY_C = '10000000-0000-4000-8000-00000000000c'

const binding = (
  overrides: Partial<NotificationBindingView> = {},
): NotificationBindingView => ({
  connectionId: CONN,
  accountId: 'account-1',
  state: 'active',
  lifecycleState: 'active',
  deletedAt: null,
  sourceEpoch: 3,
  ...overrides,
})

const allow: GoogleReviewSyncAuthorizer = async (input) => ({
  ok: true,
  accessToken: `token-for-${input.propertyId}`,
  authorization: {
    capability: 'property.connect_gbp',
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    connectionId: input.connectionId,
    initiatorUserId: null,
    expectedCredentialGeneration: 1,
    authorizationVector: { propertySourceEpoch: input.sourceEpoch },
  },
})

const setup = (
  input: Readonly<{
    connection?: GoogleConnection | null
    bindings?: Readonly<Record<string, NotificationBindingView | null>>
    authorize?: GoogleReviewSyncAuthorizer
  }> = {},
) => {
  const bindings = input.bindings ?? { [PROPERTY_A]: binding() }
  const authorizeSystemCall = vi.fn(input.authorize ?? allow)
  const authorizer = createGoogleNotificationProviderAuthorizer({
    findConnection: async () =>
      input.connection === undefined ? buildTestGoogleConnection() : input.connection,
    findLinkedPropertyIds: async () => Object.keys(bindings),
    readBinding: async (_organizationId, property) => bindings[property] ?? null,
    authorizeSystemCall,
  })
  return { authorizer, authorizeSystemCall }
}

describe('createGoogleNotificationProviderAuthorizer', () => {
  it('authorizes the exact bound account with the notification operation', async () => {
    const { authorizer, authorizeSystemCall } = setup()

    const result = await authorizer(ORG, CONN)

    expect(result).toEqual({
      ok: true,
      unauthorizedAccounts: 0,
      targets: [
        expect.objectContaining({
          accessToken: `token-for-${PROPERTY_A}`,
          gbpAccountId: 'account-1',
        }),
      ],
    })
    expect(authorizeSystemCall).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: propertyId(PROPERTY_A),
      connectionId: CONN,
      sourceEpoch: 3,
      operationKey: 'notifications.manage',
    })
  })

  it('targets each account once, through its first Property in id order', async () => {
    const { authorizer, authorizeSystemCall } = setup({
      bindings: {
        [PROPERTY_C]: binding({ accountId: 'account-2' }),
        [PROPERTY_B]: binding(),
        [PROPERTY_A]: binding(),
      },
    })

    const result = await authorizer(ORG, CONN)

    expect(result.ok && result.targets.map((target) => target.gbpAccountId)).toEqual([
      'account-1',
      'account-2',
    ])
    expect(authorizeSystemCall.mock.calls.map(([call]) => call.propertyId)).toEqual([
      PROPERTY_A,
      PROPERTY_C,
    ])
  })

  it('reports a connection with no usable binding as having no account, not as a refusal', async () => {
    const { authorizer, authorizeSystemCall } = setup({
      bindings: {
        [PROPERTY_A]: binding({ state: 'disconnected' }),
        [PROPERTY_B]: binding({ connectionId: OTHER_CONN }),
        [PROPERTY_C]: binding({ accountId: null }),
      },
    })

    await expect(authorizer(ORG, CONN)).resolves.toEqual({
      ok: true,
      targets: [],
      unauthorizedAccounts: 0,
    })
    expect(authorizeSystemCall).not.toHaveBeenCalled()
  })

  it.each([
    ['archived', binding({ lifecycleState: 'archived' })],
    ['deleted', binding({ deletedAt: new Date('2026-09-01T00:00:00Z') })],
    ['unreadable', null],
  ])('skips a %s Property', async (_label, view) => {
    const { authorizer } = setup({ bindings: { [PROPERTY_A]: view } })

    await expect(authorizer(ORG, CONN)).resolves.toEqual({
      ok: true,
      targets: [],
      unauthorizedAccounts: 0,
    })
  })

  it('counts an account it could not authorize while another one goes ahead', async () => {
    const { authorizer } = setup({
      bindings: {
        [PROPERTY_A]: binding(),
        [PROPERTY_B]: binding({ accountId: 'account-2' }),
      },
      authorize: async (input) =>
        input.propertyId === PROPERTY_B
          ? { ok: false, code: 'authorization_denied' }
          : allow(input),
    })

    const result = await authorizer(ORG, CONN)

    expect(result).toMatchObject({ ok: true, unauthorizedAccounts: 1 })
    expect(result.ok && result.targets.map((target) => target.gbpAccountId)).toEqual([
      'account-1',
    ])
  })

  it('does not count an account a later Property of it authorized', async () => {
    const { authorizer } = setup({
      bindings: { [PROPERTY_A]: binding(), [PROPERTY_B]: binding() },
      authorize: async (input) =>
        input.propertyId === PROPERTY_A
          ? { ok: false, code: 'stale_source' }
          : allow(input),
    })

    await expect(authorizer(ORG, CONN)).resolves.toMatchObject({
      ok: true,
      unauthorizedAccounts: 0,
      targets: [expect.objectContaining({ gbpAccountId: 'account-1' })],
    })
  })

  it('refuses when every usable binding is denied', async () => {
    const { authorizer } = setup({
      authorize: async () => ({ ok: false, code: 'authorization_denied' }),
    })

    await expect(authorizer(ORG, CONN)).resolves.toEqual({
      ok: false,
      code: 'authorization_unavailable',
    })
  })

  it('stops at the first runtime failure', async () => {
    const { authorizer, authorizeSystemCall } = setup({
      bindings: {
        [PROPERTY_A]: binding(),
        [PROPERTY_B]: binding({ accountId: 'account-2' }),
      },
      authorize: async () => ({ ok: false, code: 'runtime_unavailable' }),
    })

    await expect(authorizer(ORG, CONN)).resolves.toEqual({
      ok: false,
      code: 'authorization_unavailable',
    })
    expect(authorizeSystemCall).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing', null, 'connection_missing'],
    [
      'reauthorization-required',
      buildTestGoogleConnection({ status: 'reauth_required' }),
      'connection_inactive',
    ],
    [
      'cleanup-only',
      buildTestGoogleConnection({ credentialUseState: 'cleanup_only' }),
      'connection_inactive',
    ],
  ] as const)('refuses a %s connection', async (_label, connection, code) => {
    const { authorizer, authorizeSystemCall } = setup({ connection })

    await expect(authorizer(ORG, CONN)).resolves.toEqual({ ok: false, code })
    expect(authorizeSystemCall).not.toHaveBeenCalled()
  })

  it('answers authorization_unavailable when a read fails', async () => {
    const authorizer = createGoogleNotificationProviderAuthorizer({
      findConnection: async () => buildTestGoogleConnection(),
      findLinkedPropertyIds: async () => {
        throw new Error('database unavailable')
      },
      readBinding: async () => binding(),
      authorizeSystemCall: allow,
    })

    await expect(authorizer(ORG, CONN)).resolves.toEqual({
      ok: false,
      code: 'authorization_unavailable',
    })
  })
})
