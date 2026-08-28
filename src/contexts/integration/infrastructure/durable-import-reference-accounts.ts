import type {
  GoogleImportReferenceStore,
  ImportReferenceResult,
} from '../application/ports/google-import-reference-store.port'
import type { ImportAccountPageDto } from '../application/google-import-v2-contract'
import {
  durableAccountPayloadSchema,
  durableAccountsCursorPayloadSchema,
} from './durable-import-reference-codec'
import type { createDurableImportReferencePublisher } from './durable-import-reference-publication'
import type { createDurableImportReferenceReader } from './durable-import-reference-reader'

const MAX_ACCOUNTS_PER_PAGE = 20
const MAX_CURSOR_REDEMPTIONS = 50

type AccountMethods = 'publishAccountPage' | 'resolveAccount' | 'redeemAccountsCursor'

const validBudget = (value: number | undefined): number | null => {
  const budget = value ?? MAX_CURSOR_REDEMPTIONS
  return Number.isInteger(budget) && budget >= 1 && budget <= MAX_CURSOR_REDEMPTIONS
    ? budget
    : null
}

export const createDurableImportReferenceAccounts = (
  deps: Readonly<{
    publisher: ReturnType<typeof createDurableImportReferencePublisher>
    reader: ReturnType<typeof createDurableImportReferenceReader>
  }>,
): Pick<GoogleImportReferenceStore, AccountMethods> => ({
  publishAccountPage: async (input) => {
    const budget = validBudget(input.cursorRedemptionBudget)
    if (
      input.accounts.length > MAX_ACCOUNTS_PER_PAGE ||
      budget === null ||
      input.accounts.some(
        (account) => !durableAccountPayloadSchema.safeParse(account).success,
      ) ||
      (input.nextPageToken !== null &&
        !durableAccountsCursorPayloadSchema.safeParse({
          pageToken: input.nextPageToken,
        }).success)
    ) {
      return { ok: false, code: 'capacity_exceeded' }
    }
    return deps.publisher.publish<ImportAccountPageDto>({
      authorization: input.authorization,
      contentDeadlineMs: input.contentDeadlineMs,
      build: ({ lease, issuedAt, expiresAt, createRecord }) => {
        const accounts = input.accounts.map((account) =>
          createRecord('account_selection', account),
        )
        if (accounts.some((record) => record === null)) return null
        const cursor = input.nextPageToken
          ? createRecord(
              'accounts_cursor',
              { pageToken: input.nextPageToken },
              null,
              budget,
            )
          : null
        if (input.nextPageToken && !cursor) return null
        return {
          records: [
            ...accounts.filter((record) => record !== null),
            ...(cursor ? [cursor] : []),
          ],
          value: Object.freeze({
            items: Object.freeze(
              input.accounts.map((account, index) =>
                Object.freeze({
                  accountRef: accounts[index]!.handle,
                  displayName: account.displayName,
                  role: account.role,
                }),
              ),
            ),
            nextCursor: cursor?.handle ?? null,
            contentExpiresAt: expiresAt.toISOString(),
            authorizationLease: lease,
            contentTtlSeconds: Math.ceil(
              (expiresAt.getTime() - issuedAt.getTime()) / 1_000,
            ),
          }),
        }
      },
    })
  },

  resolveAccount: async (input) => {
    const loaded = await deps.reader.load({
      handle: input.accountRef,
      audience: 'account_selection',
      authorization: input.authorization,
      schema: durableAccountPayloadSchema,
    })
    return loaded.ok
      ? {
          ok: true,
          accountId: loaded.payload.accountId,
          displayName: loaded.payload.displayName,
          role: loaded.payload.role,
        }
      : loaded
  },

  redeemAccountsCursor: async (
    input,
  ): Promise<ImportReferenceResult<{ pageToken: string }>> => {
    const redeemed = await deps.reader.redeemCursor({
      handle: input.cursorRef,
      audience: 'accounts_cursor',
      authorization: input.authorization,
      schema: durableAccountsCursorPayloadSchema,
    })
    return redeemed.ok ? { ok: true, pageToken: redeemed.payload.pageToken } : redeemed
  },
})
