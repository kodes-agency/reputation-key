import { describe, expect, it, vi } from 'vitest'
import { googleAuthorizationPermissionDigest } from '#/shared/domain/google-content-authorization-vector'
import {
  actor,
  allow,
  connection,
  contentAuthorization,
  destinationId,
  frozenAtApproval,
  propertyRead,
  publish,
  RELINK_PROPERTIES,
  setup,
} from './google-import-command-authorizer.test-fixtures'

describe('authorizeGoogleImportCommand', () => {
  it('rechecks destination generations and scoped permission before publication', async () => {
    const allowed = setup()
    const result = await publish(allowed, { properties: RELINK_PROPERTIES })
    expect(result.ok).toBe(true)
    expect(allowed.readProperty).toHaveBeenCalledWith(actor.organizationId, destinationId)
    expect(allowed.decide).toHaveBeenCalledTimes(3)

    const stale = setup()
    stale.readProperty.mockResolvedValueOnce({
      ...(await stale.readProperty()),
      sourceEpoch: 9,
    })
    await expect(publish(stale, { properties: RELINK_PROPERTIES })).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
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
          : { ...allow(), allowed: false, reason: 'capability_disabled' }
      },
    })

    await expect(publish(denied, { properties: RELINK_PROPERTIES })).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(denied.decide).toHaveBeenCalledTimes(3)
  })

  // One import job mixing a create with a relink. Both items freeze the same
  // authorization at approval time, then run as separate delayed effects. The
  // content authority reports the live execution-control generation. A sibling
  // may advance that generation while this item's own authorization remains
  // unchanged, so authorization is re-proved instead of comparing a global
  // generation snapshot.
  describe('a sibling item advancing the execution-control generation', () => {
    /** What the content authority reports once the control generation moves. */
    const atGeneration = (
      generation: number,
      overrides: Partial<{ role: string }> = {},
    ) => {
      const base = contentAuthorization()
      return {
        ...base,
        policyVersion: generation,
        authorizationVector: {
          ...base.authorizationVector,
          ...overrides,
        },
      }
    }

    it('does not cancel the relink when only the control generation moves', async () => {
      let globalPolicyGeneration = 11
      const frozen = frozenAtApproval()

      // An unrelated sibling advances the live control generation.
      globalPolicyGeneration += 1

      const fixture = setup({
        authorizeGoogleContent: async () => atGeneration(globalPolicyGeneration),
      })

      const result = await publish(fixture, {
        expected: frozen,
        properties: RELINK_PROPERTIES,
      })

      expect(result).toMatchObject({ ok: true })
      // The relink item still had to re-prove its own authorization from
      // scratch: org import, org connect, and the property-scoped decision.
      expect(fixture.decide).toHaveBeenCalledTimes(3)
    })

    it('survives a generation that moved many times, not merely by one', async () => {
      const frozen = frozenAtApproval()
      const fixture = setup({
        authorizeGoogleContent: async () => atGeneration(4096),
      })

      await expect(
        publish(fixture, { expected: frozen, properties: RELINK_PROPERTIES }),
      ).resolves.toMatchObject({ ok: true })
    })

    it('still cancels when the actor lost authority in the same window', async () => {
      const frozen = frozenAtApproval()
      const fixture = setup({
        authorizeGoogleContent: async () => atGeneration(12, { role: 'Member' }),
      })

      await expect(
        publish(fixture, { expected: frozen, properties: RELINK_PROPERTIES }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    })

    it('still denies when the fresh property-scoped decision refuses access', async () => {
      // A generation counter cannot prove that this property's decision stayed
      // valid. The property-scoped decision is therefore re-proved freshly.
      let calls = 0
      const fixture = setup({
        authorizeGoogleContent: async () => atGeneration(12),
        decide: async () => {
          calls += 1
          return calls < 3
            ? allow()
            : { ...allow(), allowed: false, reason: 'capability_disabled' }
        },
      })

      await expect(
        publish(fixture, {
          expected: frozenAtApproval(),
          properties: RELINK_PROPERTIES,
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
    /** Frozen at approval while the connection sat at generation 5. */
    const frozenAtGeneration5 = frozenAtApproval({ credentialGeneration: 5 })

    it('no longer cancels the item when the generation moved forward', async () => {
      // The refresh landed: the connection is at 6, the revocation epochs did
      // not move, and the content authority reports the fresh generation.
      const fixture = setup({
        current: connection({ credentialGeneration: 6 }),
        authorizeGoogleContent: async () =>
          contentAuthorization({ credentialGeneration: 6 }),
      })

      await expect(
        publish(fixture, {
          expected: frozenAtGeneration5,
          properties: RELINK_PROPERTIES,
        }),
      ).resolves.toMatchObject({
        ok: true,
        authorization: { credentialGeneration: 6 },
      })
    })

    it('still denies a generation REGRESSION, naming the site and the values', async () => {
      const warn = vi.fn()
      const fixture = setup({
        current: connection({ credentialGeneration: 4 }),
        authorizeGoogleContent: async () =>
          contentAuthorization({ credentialGeneration: 4 }),
        warn,
      })

      await expect(
        publish(fixture, {
          expected: frozenAtGeneration5,
          properties: RELINK_PROPERTIES,
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
      const fixture = setup({
        current: connection({ lifecycleVersion: 4, credentialGeneration: 6 }),
        authorizeGoogleContent: async () =>
          contentAuthorization({ credentialGeneration: 6 }),
      })

      await expect(
        publish(fixture, {
          expected: frozenAtGeneration5,
          properties: RELINK_PROPERTIES,
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    })

    it('names the property_snapshot site when the relink target drifted', async () => {
      const warn = vi.fn()
      const fixture = setup({ warn })
      fixture.readProperty.mockResolvedValueOnce(
        propertyRead({ sourceEpoch: 9, profileVersion: 7 }),
      )

      await expect(
        publish(fixture, {
          expected: frozenAtGeneration5,
          properties: RELINK_PROPERTIES,
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
  // its own SQL in google-content-authorization-check.server.ts). Exact equality here
  // cancelled healthy relinks on main: the sibling create item's provisioning
  // bumped the global policy generation between the two reads.
  describe('the authority and the local recompute read at different instants', () => {
    it('allows a global policy generation that moved between the two reads', async () => {
      const fixture = setup({
        // The authority's vector was built at generation 11; its returned
        // policyVersion - and so the local recompute - already sees 12.
        authorizeGoogleContent: async () => ({
          ...contentAuthorization(),
          policyVersion: 12,
        }),
      })

      await expect(
        publish(fixture, { properties: RELINK_PROPERTIES }),
      ).resolves.toMatchObject({ ok: true })
    })

    it('allows a credential generation that moved between the two reads', async () => {
      const fixture = setup({
        current: connection({ credentialGeneration: 6 }),
        authorizeGoogleContent: async () => contentAuthorization(),
      })

      await expect(
        publish(fixture, { properties: RELINK_PROPERTIES }),
      ).resolves.toMatchObject({
        ok: true,
        authorization: { credentialGeneration: 6 },
      })
    })

    it('still denies an authority-withdrawing difference, and the drift is never empty', async () => {
      const warn = vi.fn()
      const fixture = setup({
        warn,
        authorizeGoogleContent: async () => ({
          ...contentAuthorization(),
          authorizationVector: {
            ...contentAuthorization().authorizationVector,
            permissionDigest: 'b'.repeat(64),
          },
        }),
      })

      await expect(publish(fixture, { properties: RELINK_PROPERTIES })).resolves.toEqual({
        ok: false,
        code: 'authorization_changed',
      })

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
