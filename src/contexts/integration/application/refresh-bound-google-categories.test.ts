import { describe, expect, it, vi } from 'vitest'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { propertyId } from '#/shared/domain/ids'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import { createRefreshBoundGoogleCategories } from './refresh-bound-google-categories'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import type { GoogleBusinessInformationPort } from './google-provider-contract'

const NOW = new Date('2026-11-06T10:00:00Z')
const REFRESH_EVENT = '7c200000-0000-4000-8000-000000000001'

function setup() {
  const actor = buildTestAuthContext({ role: 'AccountAdmin' })
  const connection = buildTestGoogleConnection({ status: 'active' })
  const binding: NonNullable<
    Awaited<ReturnType<PropertyGoogleBindingPublicApi['readInternal']>>
  > = {
    organizationId: actor.organizationId,
    propertyId: propertyId('7c100000-0000-4000-8000-000000000001'),
    connectionId: connection.id,
    state: 'active',
    accountId: 'account',
    locationId: 'location',
    sourceEpoch: 7,
    profileVersion: 3,
    profileSource: 'tenant_confirmed',
    profileConfirmedAt: NOW,
    deletedAt: null,
    lifecycleState: 'active',
    name: 'Synthetic Property',
    address: null,
    countryCode: null,
    timezone: 'Europe/Sofia',
    googleReviewDestination: {
      state: 'unavailable',
      uri: null,
      retrievedAt: null,
      sourceEpoch: 7,
      profileVersion: 3,
    },
  }
  const authorize = vi.fn<GoogleImportCommandAuthorizer>(async () => ({
    ok: true,
    accessToken: 'synthetic-access',
    authorization: {
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId: connection.id,
      connectionLifecycleVersion: connection.lifecycleVersion,
      connectionAccessVersion: connection.accessVersion,
      credentialGeneration: connection.credentialGeneration,
      authorizationVector: {},
    },
  }))
  const listLocations = vi.fn<GoogleBusinessInformationPort['listLocations']>(
    async () => ({
      items: [
        {
          binding: { accountId: 'account', locationId: 'location' },
          accountDisplayName: 'Synthetic account',
          businessName: 'Synthetic business',
          address: null,
          primaryCategory: 'Restaurant',
          countryCode: null,
          verification: 'unknown',
        },
      ],
      nextPageToken: null,
    }),
  )
  const refreshPrimaryCategory = vi.fn<
    PropertyGoogleBindingPublicApi['refreshPrimaryCategory']
  >(async () => true)
  const deps = {
    findPropertyIds: vi.fn(async () => [binding.propertyId]),
    binding: { readInternal: vi.fn(async () => binding), refreshPrimaryCategory },
    authorize,
    locations: { listLocations },
    clock: () => NOW,
  }
  return {
    actor,
    connection,
    binding,
    deps,
    authorize,
    listLocations,
    refreshPrimaryCategory,
    run: () => createRefreshBoundGoogleCategories(deps)(connection, actor, REFRESH_EVENT),
  }
}

describe('account reconnect category refresh', () => {
  it('retries discovery after import authorization returns with the same refresh request', async () => {
    const subject = setup()
    subject.authorize.mockResolvedValueOnce({ ok: false, code: 'authorization_denied' })
    await expect(subject.run()).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(subject.listLocations).not.toHaveBeenCalled()
    expect(subject.refreshPrimaryCategory).not.toHaveBeenCalled()

    await subject.run()
    expect(subject.listLocations).toHaveBeenCalledOnce()
    expect(subject.refreshPrimaryCategory).toHaveBeenCalledWith(
      expect.objectContaining({ refreshEventId: REFRESH_EVENT, category: 'Restaurant' }),
    )
  })

  it('reads Google and publishes only the category under the current connection and Property fences', async () => {
    const subject = setup()
    await subject.run()
    expect(subject.listLocations).toHaveBeenCalledOnce()
    expect(subject.refreshPrimaryCategory).toHaveBeenCalledExactlyOnceWith({
      organizationId: subject.actor.organizationId,
      propertyId: subject.binding.propertyId,
      connectionId: subject.connection.id,
      accountId: 'account',
      locationId: 'location',
      expectedConnectionLifecycleVersion: subject.connection.lifecycleVersion,
      expectedConnectionAccessVersion: subject.connection.accessVersion,
      expectedSourceEpoch: 7,
      expectedProfileVersion: 3,
      category: 'Restaurant',
      refreshEventId: REFRESH_EVENT,
      readAt: NOW,
    })
  })

  it('follows provider pages and authorizes again before each send', async () => {
    const subject = setup()
    subject.listLocations.mockResolvedValueOnce({ items: [], nextPageToken: 'next-page' })
    await subject.run()
    expect(
      subject.authorize.mock.calls.filter(([input]) => input.phase === 'provider_call'),
    ).toHaveLength(2)
    expect(
      subject.authorize.mock.calls.filter(([input]) => input.phase === 'publish'),
    ).toHaveLength(2)
    expect(subject.listLocations).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageToken: 'next-page' }),
    )
    expect(subject.refreshPrimaryCategory).toHaveBeenCalledOnce()
  })

  it('never reads or publishes after the connection moves to a different lifecycle', async () => {
    const subject = setup()
    const admitted = await subject.authorize({
      actor: subject.actor,
      connectionId: subject.connection.id,
      phase: 'provider_call',
      requireAccessToken: true,
    })
    if (!admitted.ok) throw new Error('Expected fixture authorization')
    subject.authorize.mockResolvedValue({
      ...admitted,
      authorization: {
        ...admitted.authorization,
        connectionLifecycleVersion: subject.connection.lifecycleVersion + 1,
      },
    })
    await expect(subject.run()).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(subject.listLocations).not.toHaveBeenCalled()
    expect(subject.refreshPrimaryCategory).not.toHaveBeenCalled()
  })

  it('refuses publication when authority is withdrawn during the Google read', async () => {
    const subject = setup()
    const page = await subject.listLocations({
      accessToken: 'synthetic-access',
      accountId: 'account',
      accountDisplayName: 'Synthetic',
      authorization: {
        capability: 'property.import_gbp_v2',
        organizationId: subject.actor.organizationId,
        connectionId: subject.connection.id,
        propertyId: null,
        initiatorUserId: subject.actor.userId,
        expectedCredentialGeneration: subject.connection.credentialGeneration,
        authorizationVector: {},
      },
    })
    subject.listLocations.mockImplementationOnce(async () => {
      subject.authorize.mockResolvedValue({ ok: false, code: 'authorization_changed' })
      return page
    })
    await expect(subject.run()).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(subject.refreshPrimaryCategory).not.toHaveBeenCalled()
  })

  it('does no provider work for Properties whose bindings are disconnected', async () => {
    const subject = setup()
    subject.deps.binding.readInternal.mockResolvedValue({
      ...subject.binding,
      state: 'disconnected',
    })
    await subject.run()
    expect(subject.authorize).not.toHaveBeenCalled()
    expect(subject.listLocations).not.toHaveBeenCalled()
    expect(subject.refreshPrimaryCategory).not.toHaveBeenCalled()
  })

  it('stops a repeated provider cursor rather than looping indefinitely', async () => {
    const subject = setup()
    subject.listLocations.mockResolvedValue({ items: [], nextPageToken: 'same-page' })
    await expect(subject.run()).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(subject.listLocations).toHaveBeenCalledTimes(2)
    expect(subject.refreshPrimaryCategory).not.toHaveBeenCalled()
  })
})
