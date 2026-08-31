import { z } from 'zod/v4'
import type {
  GbpAccount,
  GoogleAccountManagementPort,
} from '../../application/google-provider-contract'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { createGbpApiError } from '../../domain/gbp-api-error'
import { executeGoogleProviderJson } from './google-provider-adapter'
import { parseGoogleProviderResourceSuffix } from './google-resource-suffix'

const accountSchema = z
  .object({
    name: z.string().min(1).max(520),
    accountName: z.string().min(1).max(1_024),
    role: z.string().min(1).max(128).optional(),
  })
  .passthrough()

const accountsPageSchema = z
  .object({
    accounts: z.array(accountSchema).max(20).optional(),
    nextPageToken: z.string().min(1).max(2_048).optional(),
  })
  .passthrough()

const ACCOUNT_ROLES = Object.freeze({
  PRIMARY_OWNER: 'primary_owner',
  OWNER: 'owner',
  MANAGER: 'manager',
  SITE_MANAGER: 'site_manager',
} as const)

function parseAccount(raw: z.infer<typeof accountSchema>): GbpAccount | null {
  const accountId = parseGoogleProviderResourceSuffix(raw.name, 'accounts/')
  if (!accountId) return null
  return Object.freeze({
    resourceName: raw.name as `accounts/${string}`,
    accountId,
    displayName: raw.accountName,
    role:
      raw.role && raw.role in ACCOUNT_ROLES
        ? ACCOUNT_ROLES[raw.role as keyof typeof ACCOUNT_ROLES]
        : 'unknown',
  })
}

export const createGoogleAccountManagementAdapter = (
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    nowMs?: () => number
  }>,
): GoogleAccountManagementPort => {
  const nowMs = deps.nowMs ?? Date.now
  return Object.freeze({
    listAccounts: async (input) => {
      const raw = await executeGoogleProviderJson({
        operation: 'listAccounts',
        descriptor: {
          routeKey: 'account-management.accounts.list',
          accessToken: input.accessToken,
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        },
        authorization: input.authorization,
        executor: deps.executor,
        nowMs,
        signal: input.signal,
      })
      const parsed = accountsPageSchema.safeParse(raw)
      if (!parsed.success) {
        throw createGbpApiError('listAccounts', 'parse_error')
      }
      const items: GbpAccount[] = []
      const seen = new Set<string>()
      for (const rawAccount of parsed.data.accounts ?? []) {
        const account = parseAccount(rawAccount)
        if (!account || seen.has(account.accountId)) {
          throw createGbpApiError('listAccounts', 'parse_error')
        }
        seen.add(account.accountId)
        items.push(account)
      }
      return Object.freeze({
        items: Object.freeze(items),
        nextPageToken: parsed.data.nextPageToken ?? null,
      })
    },
  })
}
