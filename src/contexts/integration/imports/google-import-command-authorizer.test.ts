import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { userId } from '#/shared/domain/ids'
import { integrationError } from '../domain/errors'
import {
  actor,
  allow,
  connection,
  connectionId,
  contentAuthorization,
  providerCall,
  publish,
  RELINK_PROPERTIES,
  setup,
} from './google-import-command-authorizer.test-fixtures'

describe('authorizeGoogleImportCommand', () => {
  it('refuses content authority withdrawn during token access without a credential change', async () => {
    let tokenRead = false
    const fixture = setup({
      authorizeGoogleContent: async () =>
        tokenRead ? { ok: false, code: 'authorization_denied' } : contentAuthorization(),
    })
    fixture.getAccessToken.mockImplementation(async () => {
      tokenRead = true
      return 'plain-access-token'
    })

    await expect(providerCall(fixture)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
  })

  it('refuses a relink target changed during token access', async () => {
    const fixture = setup()
    fixture.getAccessToken.mockImplementation(async () => {
      const property = await fixture.readProperty()
      fixture.readProperty.mockResolvedValue({ ...property, sourceEpoch: 9 })
      return 'plain-access-token'
    })

    await expect(
      providerCall(fixture, { properties: RELINK_PROPERTIES }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
  })

  it('returns a connection generation snapshot only after both capability decisions', async () => {
    const fixture = setup()
    const { decide, getAccessToken } = fixture

    const result = await providerCall(fixture)

    expect(decide.mock.calls.map(([request]) => request.capability)).toEqual([
      'property.import_gbp_v2',
      'property.connect_gbp',
      'property.import_gbp_v2',
      'property.connect_gbp',
    ])
    expect(decide.mock.invocationCallOrder[1]).toBeLessThan(
      getAccessToken.mock.invocationCallOrder[0]!,
    )
    expect(decide.mock.invocationCallOrder[2]).toBeGreaterThan(
      getAccessToken.mock.invocationCallOrder[0]!,
    )
    expect(getAccessToken).toHaveBeenCalledWith(actor.organizationId, connectionId)
    expect(result).toMatchObject({
      ok: true,
      authorization: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        connectionId,
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
        authorizationVector: {
          executionPolicyVersion: 'beta-local-2',
          role: 'AccountAdmin',
          connectionLifecycleVersion: 3,
          connectionAccessVersion: 4,
          credentialGeneration: 5,
        },
      },
      accessToken: 'plain-access-token',
    })
  })

  it('reauthorizes a provider call after an authorized credential refresh', async () => {
    const fixture = setup()
    fixture.findById
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(connection({ credentialGeneration: 6 }))
    fixture.authorizeGoogleContent
      .mockResolvedValueOnce(contentAuthorization())
      .mockResolvedValueOnce(contentAuthorization({ credentialGeneration: 6 }))

    await expect(providerCall(fixture)).resolves.toMatchObject({
      ok: true,
      authorization: {
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 6,
        authorizationVector: {
          connectionLifecycleVersion: 3,
          connectionAccessVersion: 4,
          credentialGeneration: 6,
        },
      },
      accessToken: 'plain-access-token',
    })
    expect(fixture.authorizeGoogleContent).toHaveBeenCalledTimes(2)
  })

  it('fails closed when connection authority changes during token access', async () => {
    const fixture = setup()
    fixture.findById
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(connection({ lifecycleVersion: 4, credentialGeneration: 6 }))

    await expect(providerCall(fixture)).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    expect(fixture.authorizeGoogleContent).toHaveBeenCalledOnce()
  })

  it('denies before token access for capability, status, credential, or scope failure', async () => {
    const deniedDecision = setup({
      decide: async () => ({ ...allow(), allowed: false, reason: 'capability_disabled' }),
    })
    await expect(providerCall(deniedDecision)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(deniedDecision.getAccessToken).not.toHaveBeenCalled()

    for (const current of [
      connection({ status: 'disconnected' }),
      connection({ credentialUseState: 'none' }),
      connection({ scopes: [] }),
    ]) {
      const denied = setup({ current })
      await expect(providerCall(denied)).resolves.toEqual({
        ok: false,
        code: 'connection_unavailable',
      })
      expect(denied.getAccessToken).not.toHaveBeenCalled()
    }
  })

  it('treats connectedBy as provenance for a legacy private row', async () => {
    const current = connection({
      visibility: 'private',
      connectedBy: userId('former-connector'),
    })
    const fixture = setup({ current })

    await expect(
      providerCall(fixture, { requireAccessToken: false }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('requires current Organization-wide authority instead of the raw role label', async () => {
    const fixture = setup()
    const { decide, findById } = fixture
    const assignedManager: AuthContext = {
      ...actor,
      role: 'PropertyManager',
      effectivePermissions: new Set<Permission>(['integration.manage']),
      scopeByPermission: new Map<Permission, 'assigned-properties'>([
        ['integration.manage', 'assigned-properties'],
      ]),
    }

    await expect(
      providerCall(fixture, { actor: assignedManager, requireAccessToken: false }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(decide).not.toHaveBeenCalled()
    expect(findById).not.toHaveBeenCalled()
  })

  it('denies a post-call check when any frozen connection generation changed', async () => {
    const expected = {
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId,
      connectionLifecycleVersion: 3,
      connectionAccessVersion: 4,
      credentialGeneration: 5,
      authorizationVector: {
        executionPolicyVersion: 'beta-local-2',
        role: 'AccountAdmin',
        permissionDigest: 'irrelevant',
      },
    }
    const fixture = setup({
      current: connection({ credentialGeneration: 6 }),
    })

    await expect(publish(fixture, { expected })).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    expect(fixture.getAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed before token access when content authorization is unavailable', async () => {
    const denied = setup({
      authorizeGoogleContent: async () => ({
        ok: false,
        code: 'runtime_unavailable',
      }),
    })
    await expect(providerCall(denied)).resolves.toEqual({
      ok: false,
      code: 'runtime_unavailable',
      step: 'content_authorization',
    })
    expect(denied.getAccessToken).not.toHaveBeenCalled()
  })

  // On 2026-10-23 a token refresh failed inside this step and the only record was
  // "temporarily unavailable" (#946): the catch named neither the step nor the
  // failure. Each unavailable step now says which it was, content-free.
  it('names the token access step and logs its failure without the message', async () => {
    const warn = vi.fn()
    const failing = setup({ warn })
    failing.getAccessToken.mockRejectedValueOnce(
      integrationError('token_refresh_failed', 'refresh for tenant-secret failed'),
    )

    await expect(providerCall(failing)).resolves.toEqual({
      ok: false,
      code: 'runtime_unavailable',
      step: 'token_access',
    })
    expect(warn).toHaveBeenCalledWith(
      {
        step: 'token_access',
        errorName: 'IntegrationError',
        error_code: 'token_refresh_failed',
      },
      'google_import.runtime_unavailable_detail',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tenant-secret')
  })

  it('names the reread after token access separately from the token itself', async () => {
    const failing = setup()
    failing.findById
      .mockImplementationOnce(async () => connection())
      .mockRejectedValueOnce(new Error('connection read failed'))

    await expect(providerCall(failing)).resolves.toEqual({
      ok: false,
      code: 'runtime_unavailable',
      step: 'token_reread',
    })
  })

  it('names the capability decision step when the policy read fails', async () => {
    const warn = vi.fn()
    const failing = setup({
      decide: async () => {
        throw new TypeError('policy store down')
      },
      warn,
    })

    await expect(providerCall(failing)).resolves.toEqual({
      ok: false,
      code: 'runtime_unavailable',
      step: 'capability_decision',
    })
    expect(warn).toHaveBeenCalledWith(
      { step: 'capability_decision', errorName: 'TypeError' },
      'google_import.runtime_unavailable_detail',
    )
  })
})
