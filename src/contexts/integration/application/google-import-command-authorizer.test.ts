import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { ExecutionDecision } from '#/shared/auth/execution-policy'
import { googleAuthorizationPermissionDigest } from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnection } from '../domain/types'
import { createGoogleImportCommandAuthorizer } from './google-import-command-authorizer'

const actor: AuthContext = {
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  role: 'AccountAdmin',
  effectivePermissions: new Set([
    'integration.manage',
    'property.read',
    'property.update',
  ]),
}
const connectionId = googleConnectionId('11111111-1111-4111-8111-111111111111')
const destinationId = propertyId('22222222-2222-4222-8222-222222222222')
const approvalBindingId = '33333333-3333-4333-8333-333333333333'

const connection = (overrides: Partial<GoogleConnection> = {}): GoogleConnection => ({
  id: connectionId,
  organizationId: actor.organizationId,
  googleSubject: 'subject',
  encryptedAccessToken: 'encrypted-access',
  encryptedRefreshToken: 'encrypted-refresh',
  tokenExpiresAt: new Date('2026-08-12T11:00:00.000Z'),
  scopes: ['https://www.googleapis.com/auth/business.manage'],
  connectedBy: actor.userId,
  visibility: 'organization',
  status: 'active',
  credentialUseState: 'active',
  cleanupMaterialDeadlineAt: null,
  lifecycleVersion: 3,
  accessVersion: 4,
  credentialGeneration: 5,
  encryptionKeyId: 'v1',
  lastSuccessfulSyncAt: null,
  statusReason: null,
  statusChangedAt: null,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  ...overrides,
})

const allow = (policyVersion = 'beta-local-2'): ExecutionDecision => ({
  allowed: true,
  reason: 'allowed',
  action: 'integration.manage',
  policyVersion,
})

const contentAuthorization = (
  overrides: Partial<{
    connectionLifecycleVersion: number
    connectionAccessVersion: number
    credentialGeneration: number
  }> = {},
) => ({
  ok: true as const,
  approvalBindingId,
  policyVersion: 11,
  emergencyKillVersion: 4,
  authorizationVector: {
    executionPolicyVersion: 'beta-local-2',
    googleContentPolicyVersion: 11,
    emergencyKillVersion: 4,
    role: 'AccountAdmin',
    permissionDigest: googleAuthorizationPermissionDigest(actor),
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration: 5,
    ...overrides,
  },
})

function setup(
  input?: Readonly<{
    current?: GoogleConnection | null
    decide?: (
      request: Parameters<
        Parameters<typeof createGoogleImportCommandAuthorizer>[0]['decide']
      >[0],
    ) => Promise<ExecutionDecision>
    authorizeGoogleContent?: (
      input: Parameters<
        Parameters<
          typeof createGoogleImportCommandAuthorizer
        >[0]['authorizeGoogleContent']
      >[0],
    ) => Promise<
      Awaited<
        ReturnType<
          Parameters<
            typeof createGoogleImportCommandAuthorizer
          >[0]['authorizeGoogleContent']
        >
      >
    >
    /**
     * Only the cases that assert on the refusal log pass this; every other
     * case leaves it unset, which is what proves the dep is optional and
     * defaults to a no-op.
     */
    warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
) {
  const findById = vi.fn(async () => input?.current ?? connection())
  const getAccessToken = vi.fn(async () => 'plain-access-token')
  const decide = vi.fn(input?.decide ?? (async () => allow()))
  const authorizeGoogleContent = vi.fn(
    input?.authorizeGoogleContent ?? (async () => contentAuthorization()),
  )
  const readProperty = vi.fn(async () => ({
    organizationId: actor.organizationId,
    propertyId: destinationId,
    state: 'disconnected' as const,
    connectionId,
    accountId: 'account-1',
    locationId: 'location-1',
    sourceEpoch: 8,
    profileVersion: 6,
    profileSource: 'tenant_confirmed' as const,
    profileConfirmedAt: new Date('2026-08-01T10:00:00.000Z'),
    deletedAt: null,
    name: 'Property',
    address: null,
    countryCode: 'US',
    timezone: 'America/New_York',
    processingRegion: 'us',
    lifecycleState: 'active',
  }))
  const authorize = createGoogleImportCommandAuthorizer({
    connectionRepo: { findById },
    tokenProvider: { getAccessToken },
    decide,
    readProperty,
    authorizeGoogleContent,
    ...(input?.warn ? { warn: input.warn } : {}),
  })
  return {
    authorize,
    findById,
    getAccessToken,
    decide,
    readProperty,
    authorizeGoogleContent,
  }
}

describe('authorizeGoogleImportCommand', () => {
  it('returns a connection generation snapshot only after both capability decisions', async () => {
    const { authorize, decide, getAccessToken } = setup()

    const result = await authorize({
      actor,
      connectionId,
      phase: 'provider_call',
      requireAccessToken: true,
    })

    expect(decide).toHaveBeenCalledTimes(2)
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
        approvalBindingId,
        authorizationVector: {
          executionPolicyVersion: 'beta-local-2',
          googleContentPolicyVersion: 11,
          emergencyKillVersion: 4,
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

    await expect(
      fixture.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toMatchObject({
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

    await expect(
      fixture.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    expect(fixture.authorizeGoogleContent).toHaveBeenCalledOnce()
  })

  it('denies before token access for capability, visibility, status, or scope failure', async () => {
    const deniedDecision = setup({
      decide: async () => ({ ...allow(), allowed: false, reason: 'capability_disabled' }),
    })
    await expect(
      deniedDecision.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(deniedDecision.getAccessToken).not.toHaveBeenCalled()

    for (const current of [
      connection({ visibility: 'private', connectedBy: userId('other-user') }),
      connection({ status: 'disconnected' }),
      connection({ credentialUseState: 'none' }),
      connection({ scopes: [] }),
    ]) {
      const denied = setup({ current })
      await expect(
        denied.authorize({
          actor,
          connectionId,
          phase: 'provider_call',
          requireAccessToken: true,
        }),
      ).resolves.toEqual({ ok: false, code: 'connection_unavailable' })
      expect(denied.getAccessToken).not.toHaveBeenCalled()
    }
  })

  it('denies a post-call check when any frozen connection generation changed', async () => {
    const expected = {
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId,
      connectionLifecycleVersion: 3,
      connectionAccessVersion: 4,
      credentialGeneration: 5,
      approvalBindingId,
      authorizationVector: {
        executionPolicyVersion: 'beta-local-2',
        googleContentPolicyVersion: 11,
        emergencyKillVersion: 4,
        role: 'AccountAdmin',
        permissionDigest: 'irrelevant',
      },
    }
    const { authorize, getAccessToken } = setup({
      current: connection({ credentialGeneration: 6 }),
    })

    await expect(
      authorize({
        actor,
        connectionId,
        phase: 'publish',
        expected,
        requireAccessToken: false,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed before token access when content approval is unavailable', async () => {
    const denied = setup({
      authorizeGoogleContent: async () => ({
        ok: false,
        code: 'runtime_unavailable',
      }),
    })
    await expect(
      denied.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toEqual({ ok: false, code: 'runtime_unavailable' })
    expect(denied.getAccessToken).not.toHaveBeenCalled()
  })

  it('rechecks destination generations and scoped permission before publication', async () => {
    const allowed = setup()
    const result = await allowed.authorize({
      actor,
      connectionId,
      phase: 'publish',
      properties: [
        {
          propertyId: destinationId,
          sourceEpoch: 8,
          profileVersion: 6,
          action: 'property.update',
        },
      ],
      requireAccessToken: false,
    })
    expect(result.ok).toBe(true)
    expect(allowed.readProperty).toHaveBeenCalledWith(actor.organizationId, destinationId)
    expect(allowed.decide).toHaveBeenCalledTimes(3)

    const stale = setup()
    stale.readProperty.mockResolvedValueOnce({
      ...(await stale.readProperty()),
      sourceEpoch: 9,
    })
    await expect(
      stale.authorize({
        actor,
        connectionId,
        phase: 'publish',
        properties: [
          {
            propertyId: destinationId,
            sourceEpoch: 8,
            profileVersion: 6,
            action: 'property.update',
          },
        ],
        requireAccessToken: false,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
  })

  // The per-property capability decision is the GATE, not the frozen
  // expectations checked immediately above it, so it must not report
  // `authorization_changed` — that code is reserved for drift, and reusing it
  // here made a denied capability indistinguishable from a moved source epoch
  // in everything downstream, including the persisted import outcome.
  it('reports a per-property capability denial as a denial, not as drift', async () => {
    let calls = 0
    const denied = setup({
      decide: async () => {
        calls += 1
        // Org-level import + connect decisions allow; only the third call,
        // the property-scoped one, denies.
        return calls < 3
          ? allow()
          : { ...allow(), allowed: false, reason: 'property_not_allowlisted' }
      },
    })

    await expect(
      denied.authorize({
        actor,
        connectionId,
        phase: 'publish',
        properties: [
          {
            propertyId: destinationId,
            sourceEpoch: 8,
            profileVersion: 6,
            action: 'property.update',
          },
        ],
        requireAccessToken: false,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(denied.decide).toHaveBeenCalledTimes(3)
  })

  // One import job mixing a create with a relink. Both items freeze the SAME
  // authorization at approval time, then run as separate delayed effects. The
  // create item's `provisionPropertyCapabilities` grants the newly created
  // property its organization's capabilities, and that INSERT carries
  // BUMP_POLICY_VERSION_SQL — so the single global policy_version row moves
  // while the relink item is still in flight. Nothing about the relink item's
  // own authorization changed; only a sibling wrote to an unrelated property.
  //
  // Measured window in the diagnosis: 11.15 ms. These tests remove the window
  // entirely by forcing the worst interleaving — the bump lands BEFORE the
  // relink item authorizes — and asserting it is no longer fatal.
  describe('a sibling item bumping the global policy generation', () => {
    const relinkProperties = [
      {
        propertyId: destinationId,
        sourceEpoch: 8,
        profileVersion: 6,
        action: 'property.update' as const,
      },
    ]

    /** The eight-key vector persisted per item at approval time. */
    const frozenAtApproval = (generation: number) => ({
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId,
      connectionLifecycleVersion: 3,
      connectionAccessVersion: 4,
      credentialGeneration: 5,
      approvalBindingId,
      authorizationVector: {
        executionPolicyVersion: 'beta-local-2',
        googleContentPolicyVersion: generation,
        emergencyKillVersion: 4,
        role: 'AccountAdmin',
        permissionDigest: googleAuthorizationPermissionDigest(actor),
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
      },
    })

    /** What the content authority reports once the global row has moved. */
    const atGeneration = (
      generation: number,
      overrides: Partial<{ emergencyKillVersion: number; role: string }> = {},
    ) => {
      const base = contentAuthorization()
      return {
        ...base,
        policyVersion: generation,
        emergencyKillVersion: overrides.emergencyKillVersion ?? base.emergencyKillVersion,
        authorizationVector: {
          ...base.authorizationVector,
          googleContentPolicyVersion: generation,
          ...overrides,
        },
      }
    }

    it('no longer cancels the relink item', async () => {
      let globalPolicyGeneration = 11
      const frozen = frozenAtApproval(globalPolicyGeneration)

      // The create sibling commits its provisioning INSERT + version bump.
      globalPolicyGeneration += 1

      const { authorize, decide } = setup({
        authorizeGoogleContent: async () => atGeneration(globalPolicyGeneration),
      })

      const result = await authorize({
        actor,
        connectionId,
        phase: 'publish',
        expected: frozen,
        properties: relinkProperties,
        requireAccessToken: false,
      })

      expect(result).toMatchObject({ ok: true, authorization: { approvalBindingId } })
      // The relink item still had to re-prove its own authorization from
      // scratch: org import, org connect, and the property-scoped decision.
      expect(decide).toHaveBeenCalledTimes(3)
    })

    it('survives a generation that moved many times, not merely by one', async () => {
      const frozen = frozenAtApproval(11)
      const { authorize } = setup({
        authorizeGoogleContent: async () => atGeneration(4096),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozen,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toMatchObject({ ok: true })
    })

    it('still cancels when the emergency kill epoch moved in the same window', async () => {
      const frozen = frozenAtApproval(11)
      const { authorize } = setup({
        authorizeGoogleContent: async () => atGeneration(12, { emergencyKillVersion: 5 }),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozen,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    })

    it('still cancels when the actor lost authority in the same window', async () => {
      const frozen = frozenAtApproval(11)
      const { authorize } = setup({
        authorizeGoogleContent: async () => atGeneration(12, { role: 'Staff' }),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozen,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    })

    it('still denies when the bump REMOVED this property from the allowlist', async () => {
      // The counter cannot tell an additive bump from a revoking one — which is
      // exactly why tolerating it would be unsafe on its own. What makes it
      // safe is that the property-scoped decision is re-proved freshly, so a
      // revocation that rode along with the bump still denies.
      let calls = 0
      const { authorize } = setup({
        authorizeGoogleContent: async () => atGeneration(12),
        decide: async () => {
          calls += 1
          return calls < 3
            ? allow()
            : { ...allow(), allowed: false, reason: 'property_not_allowlisted' }
        },
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozenAtApproval(11),
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    })
  })

  // A routine expired-access-token refresh bumps `credential_generation` and
  // NOTHING else (`updateTokens`). Requiring equality against the value frozen
  // at approval therefore reported revocation for a successful refresh and
  // cancelled any import whose token aged between approval and effect — the
  // same class of bug as the sibling-generation cancellation above, on a
  // different counter. The performance lease fence already excluded it.
  describe('a routine credential refresh between approval and effect', () => {
    const relinkProperties = [
      {
        propertyId: destinationId,
        sourceEpoch: 8,
        profileVersion: 6,
        action: 'property.update' as const,
      },
    ]

    /** Frozen at approval while the connection sat at generation 5. */
    const frozenAtGeneration5 = {
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId,
      connectionLifecycleVersion: 3,
      connectionAccessVersion: 4,
      credentialGeneration: 5,
      approvalBindingId,
      authorizationVector: {
        executionPolicyVersion: 'beta-local-2',
        googleContentPolicyVersion: 11,
        emergencyKillVersion: 4,
        role: 'AccountAdmin',
        permissionDigest: googleAuthorizationPermissionDigest(actor),
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
      },
    }

    it('no longer cancels the item when the generation moved forward', async () => {
      // The refresh landed: the connection is at 6, the revocation epochs did
      // not move, and the content authority reports the fresh generation.
      const { authorize } = setup({
        current: connection({ credentialGeneration: 6 }),
        authorizeGoogleContent: async () =>
          contentAuthorization({ credentialGeneration: 6 }),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozenAtGeneration5,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toMatchObject({
        ok: true,
        authorization: { credentialGeneration: 6 },
      })
    })

    it('still denies a generation REGRESSION, naming the site and the values', async () => {
      const warn = vi.fn()
      const { authorize } = setup({
        current: connection({ credentialGeneration: 4 }),
        authorizeGoogleContent: async () =>
          contentAuthorization({ credentialGeneration: 4 }),
        warn,
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozenAtGeneration5,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[1]).toBe('google_import.authorization_changed_detail')
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        site: 'expected_connection_pre_token',
        expected: { credentialGeneration: 5 },
        observed: { credentialGeneration: 4 },
      })
    })

    it('still denies when a revocation epoch moved alongside the generation', async () => {
      const { authorize } = setup({
        current: connection({ lifecycleVersion: 4, credentialGeneration: 6 }),
        authorizeGoogleContent: async () =>
          contentAuthorization({ credentialGeneration: 6 }),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozenAtGeneration5,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    })

    it('names the property_snapshot site when the relink target drifted', async () => {
      const warn = vi.fn()
      const fixture = setup({ warn })
      fixture.readProperty.mockResolvedValueOnce({
        organizationId: actor.organizationId,
        propertyId: destinationId,
        state: 'disconnected' as const,
        connectionId,
        accountId: 'account-1',
        locationId: 'location-1',
        sourceEpoch: 9,
        profileVersion: 7,
        profileSource: 'tenant_confirmed' as const,
        profileConfirmedAt: new Date('2026-08-01T10:00:00.000Z'),
        deletedAt: null,
        name: 'Property',
        address: null,
        countryCode: 'US',
        timezone: 'America/New_York',
        processingRegion: 'us',
        lifecycleState: 'active',
      })

      await expect(
        fixture.authorize({
          actor,
          connectionId,
          phase: 'publish',
          expected: frozenAtGeneration5,
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })

      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        site: 'property_snapshot',
        expected: { sourceEpoch: 8, profileVersion: 6 },
        observed: { sourceEpoch: 9, profileVersion: 7, missing: false, deleted: false },
      })
    })
  })

  // The same-request vector check compares the content authority's vector with
  // a local recompute - and those come from DIFFERENT reads (the authority runs
  // its own SQL in google-content-authorization-check.ts). Exact equality here
  // cancelled healthy relinks on main: the sibling create item's provisioning
  // bumped the global policy generation between the two reads.
  describe('the authority and the local recompute read at different instants', () => {
    const relinkProperties = [
      {
        propertyId: destinationId,
        sourceEpoch: 8,
        profileVersion: 6,
        action: 'property.update' as const,
      },
    ]

    it('allows a global policy generation that moved between the two reads', async () => {
      const { authorize } = setup({
        // The authority's vector was built at generation 11; its returned
        // policyVersion - and so the local recompute - already sees 12.
        authorizeGoogleContent: async () => ({
          ...contentAuthorization(),
          policyVersion: 12,
        }),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toMatchObject({ ok: true })
    })

    it('allows a credential generation that moved between the two reads', async () => {
      const { authorize } = setup({
        current: connection({ credentialGeneration: 6 }),
        authorizeGoogleContent: async () => contentAuthorization(),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toMatchObject({
        ok: true,
        authorization: { credentialGeneration: 6 },
      })
    })

    it('still denies an authority-withdrawing difference, and the drift is never empty', async () => {
      const warn = vi.fn()
      const { authorize } = setup({
        warn,
        authorizeGoogleContent: async () => ({
          ...contentAuthorization(),
          authorizationVector: {
            ...contentAuthorization().authorizationVector,
            permissionDigest: 'b'.repeat(64),
          },
        }),
      })

      await expect(
        authorize({
          actor,
          connectionId,
          phase: 'publish',
          properties: relinkProperties,
          requireAccessToken: false,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })

      const logged = warn.mock.calls[0]?.[0] as { site: string; drift: unknown[] }
      expect(logged.site).toBe('same_request_vector')
      // The whole point of the report: a denial always names a key. A previous
      // version logged `drift: []` here because it excluded the keys that had
      // actually moved.
      expect(logged.drift).toEqual([
        {
          key: 'permissionDigest',
          frozen: 'b'.repeat(64),
          recomputed: googleAuthorizationPermissionDigest(actor),
        },
      ])
    })
  })
})
