import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { createGoogleNotificationAccountUsageReader } from './google-notification-account-usage'
import type { NotificationBindingView } from './google-notification-provider-authorizer'

const ORG_A = organizationId('org-a')
const ORG_B = organizationId('org-b')
const CONN_A = googleConnectionId('e0000000-0000-0000-0000-000000000001')
const CONN_B = googleConnectionId('e0000000-0000-0000-0000-000000000002')
const PROPERTY = '10000000-0000-4000-8000-000000000001'
const ACCOUNT = 'repkey-synthetic-do-not-use-account-0001'
const input = { organizationId: ORG_A, connectionId: CONN_A, gbpAccountId: ACCOUNT }

function setup(otherBinding: Partial<NotificationBindingView> = {}) {
  const connectionA = buildTestGoogleConnection({ id: CONN_A, organizationId: ORG_A })
  const connectionB = buildTestGoogleConnection({ id: CONN_B, organizationId: ORG_B })
  const binding: NotificationBindingView = {
    connectionId: CONN_B,
    accountId: ACCOUNT,
    state: 'active',
    lifecycleState: 'active',
    deletedAt: null,
    sourceEpoch: 1,
    ...otherBinding,
  }
  const deps = {
    listOrganizations: vi.fn(async () => [ORG_A, ORG_B]),
    listConnections: vi.fn(async (org: typeof ORG_A) =>
      org === ORG_A ? [connectionA] : [connectionB],
    ),
    findLinkedPropertyIds: vi.fn(async () => [PROPERTY]),
    readBinding: vi.fn(async () => binding),
  }
  return { deps, read: createGoogleNotificationAccountUsageReader(deps), connectionB }
}

describe('Google notification account usage', () => {
  it('retains the setting when another organization has an active binding', async () => {
    const { read, deps } = setup()
    await expect(read(input)).resolves.toBe(true)
    expect(deps.findLinkedPropertyIds).toHaveBeenCalledExactlyOnceWith(CONN_B, ORG_B)
    expect(deps.readBinding).toHaveBeenCalledExactlyOnceWith(ORG_B, PROPERTY)
  })

  it('also retains a setting needed by another connection in the same organization', async () => {
    const { read, deps, connectionB } = setup()
    deps.listOrganizations.mockResolvedValue([ORG_A])
    deps.listConnections.mockResolvedValue([{ ...connectionB, organizationId: ORG_A }])
    await expect(read(input)).resolves.toBe(true)
    expect(deps.readBinding).toHaveBeenCalledWith(ORG_A, PROPERTY)
  })

  it('allows clearing after the other organization disconnects', async () => {
    const { read, deps } = setup()
    deps.listOrganizations.mockResolvedValue([ORG_A])
    await expect(read(input)).resolves.toBe(false)
    expect(deps.readBinding).not.toHaveBeenCalled()
  })

  it('refuses clearing when establishing account usage would exceed the read budget', async () => {
    const { read, deps } = setup({ accountId: 'another-account' })
    deps.findLinkedPropertyIds.mockResolvedValue(
      Array.from({ length: 1_100 }, () => PROPERTY),
    )
    await expect(read(input)).rejects.toThrow(
      'Google notification account usage incomplete',
    )
    expect(deps.readBinding.mock.calls.length).toBeLessThan(1_100)
  })

  it.each([
    { accountId: 'another-account' },
    { connectionId: CONN_A },
    { state: 'disconnected' },
    { lifecycleState: 'archived' },
    { deletedAt: new Date('2026-11-01T00:00:00Z') },
  ])('does not retain for an unrelated or inactive binding: %j', async (binding) => {
    const { read } = setup(binding)
    await expect(read(input)).resolves.toBe(false)
  })

  it.each([
    'listOrganizations',
    'listConnections',
    'findLinkedPropertyIds',
    'readBinding',
  ] as const)(
    'propagates a failed %s instead of treating the account as unused',
    async (method) => {
      const { read, deps } = setup()
      deps[method].mockRejectedValueOnce(new Error('read unavailable'))
      await expect(read(input)).rejects.toThrow('read unavailable')
    },
  )
})
