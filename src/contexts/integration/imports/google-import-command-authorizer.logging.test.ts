import { describe, expect, it, vi, type Mock } from 'vitest'
import { BANNED_LOG_KEYS } from '#/shared/observability/metrics-schema'
import {
  connection,
  contentAuthorization,
  frozenAtApproval,
  providerCall,
  publish,
  RELINK_PROPERTIES,
  setup,
} from './google-import-command-authorizer.test-fixtures'

// Tenant identifiers are never log fields (BANNED_LOG_KEYS). The logger-call-site
// gate cannot see through the injected `warn`, so the sites that build their
// fields in a helper are held to the rule here.
describe('the authorization_changed log', () => {
  const frozen = frozenAtApproval()
  const loggedKeys = (value: unknown): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => [key, ...loggedKeys(child)])
      : []
  const bannedKeysLogged = (warn: Mock) =>
    warn.mock.calls
      .flatMap((call) => loggedKeys(call[0]))
      .filter((key) => (BANNED_LOG_KEYS as readonly string[]).includes(key))

  type Trigger = (warn: Mock) => Promise<unknown>
  const cases: ReadonlyArray<readonly [title: string, site: string, trigger: Trigger]> = [
    [
      'names the site and the drift without a tenant identifier when the connection regressed',
      'expected_connection_pre_token',
      (warn) =>
        publish(
          setup({
            current: connection({ credentialGeneration: 4 }),
            authorizeGoogleContent: async () =>
              contentAuthorization({ credentialGeneration: 4 }),
            warn,
          }),
          { expected: frozen, properties: RELINK_PROPERTIES },
        ),
    ],
    [
      'names the site and the drift without a tenant identifier when the relink target drifted',
      'property_snapshot',
      async (warn) => {
        const fixture = setup({ warn })
        fixture.readProperty.mockResolvedValueOnce({
          ...(await fixture.readProperty()),
          sourceEpoch: 9,
        })
        return publish(fixture, { expected: frozen, properties: RELINK_PROPERTIES })
      },
    ],
    [
      'names the site and the counters without a tenant identifier when the connection moved during token access',
      'connection_moved_during_token_access',
      (warn) => {
        const fixture = setup({ warn })
        fixture.findById
          .mockResolvedValueOnce(connection())
          .mockResolvedValueOnce(connection({ lifecycleVersion: 4 }))
        return providerCall(fixture)
      },
    ],
  ]

  it.each(cases)('%s', async (_title, site, trigger) => {
    const warn = vi.fn()

    await trigger(warn)

    expect(warn.mock.calls[0]?.[0]).toMatchObject({ site })
    expect(bannedKeysLogged(warn)).toEqual([])
  })
})
