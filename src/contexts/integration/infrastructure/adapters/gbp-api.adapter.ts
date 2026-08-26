// Integration context — account-resolution adapter for GBP notification cleanup.
// Import discovery uses the authorized Account Management and Business Information
// adapters; this narrow port exists only for the best-effort notification lifecycle.

import { z } from 'zod/v4'
import type { GbpApiPort, GbpAccount } from '../../application/ports/gbp-api.port'
import { createGbpApiError } from '../../domain/gbp-api-error'
import type { GbpApiErrorKind } from '../../domain/gbp-api-error'
import { trace } from '#/shared/observability/trace'
import { providerFetch } from './gbp-provider-fetch'

const MAX_ACCOUNT_PAGES = 100
const ACCOUNT_PAGE_SIZE = '20'

const accountSchema = z
  .object({
    name: z.string().regex(/^accounts\/[A-Za-z0-9_-]+$/),
    accountName: z.string().min(1).max(1_024),
    type: z.string().min(1).max(128).optional(),
    role: z.string().min(1).max(128).optional(),
  })
  .passthrough()

const pageSchema = z
  .object({
    accounts: z.array(accountSchema).max(20).optional(),
    nextPageToken: z.string().min(1).max(2_048).optional(),
  })
  .passthrough()

function classifyHttpStatus(status: number): GbpApiErrorKind {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  return 'upstream_error'
}

function mapAccount(account: z.infer<typeof accountSchema>): GbpAccount {
  const accountName = account.name.slice('accounts/'.length)
  return Object.freeze({
    name: account.name,
    accountName,
    type: account.type ?? 'UNKNOWN',
    role: account.role ?? null,
  })
}

export const createGbpApiAdapter = (config: {
  baseUrl: string
  assertDirectCredentialEgressAllowed?: (operation: string) => void
}): GbpApiPort => ({
  listAccounts: async (accessToken) => {
    config.assertDirectCredentialEgressAllowed?.('account-management.accounts.list')
    const allAccounts: GbpAccount[] = []
    const seenAccountIds = new Set<string>()
    const seenPageTokens = new Set<string>()
    let nextPageToken: string | undefined

    for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
      const params = new URLSearchParams({ pageSize: ACCOUNT_PAGE_SIZE })
      if (nextPageToken) params.set('pageToken', nextPageToken)
      const url = `${config.baseUrl}/accounts?${params.toString()}`
      // providerFetch classifies a transport rejection (unreachable provider)
      // as upstream_error inside the span, so neither the caller nor the span's
      // error record ever sees a raw TypeError.
      const response = await trace('gbpApi.listAccounts', () =>
        providerFetch('listAccounts', url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      )
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw createGbpApiError('listAccounts', classifyHttpStatus(response.status))
      }

      const parsed = pageSchema.safeParse(await response.json())
      if (!parsed.success) throw createGbpApiError('listAccounts', 'parse_error')
      for (const rawAccount of parsed.data.accounts ?? []) {
        const account = mapAccount(rawAccount)
        if (seenAccountIds.has(account.accountName)) {
          throw createGbpApiError('listAccounts', 'parse_error')
        }
        seenAccountIds.add(account.accountName)
        allAccounts.push(account)
      }

      nextPageToken = parsed.data.nextPageToken
      if (!nextPageToken) return Object.freeze(allAccounts)
      if (seenPageTokens.has(nextPageToken)) {
        throw createGbpApiError('listAccounts', 'parse_error')
      }
      seenPageTokens.add(nextPageToken)
    }

    throw createGbpApiError('listAccounts', 'parse_error')
  },
})
