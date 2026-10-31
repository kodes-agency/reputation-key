import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('shell AI update gate', () => {
  const shell = read('../_authenticated.tsx')
  const body = read('./-merchant-ai-notice-update.tsx')
  const client = read('./-merchant-ai-notice-update-client.ts')
  const settings = '../../components/features/settings'
  const query = read(`${settings}/merchant-ai-notice-update-query.ts`)
  const markSeen = read(`${settings}/use-mark-merchant-ai-notice-update-seen.ts`)
  it('loads the side read only through a lazy boundary behind AccountAdmin and ai.manage', () => {
    expect(shell).toMatch(
      /lazy\(\s*\(\) => import\('\.\/_authenticated\/-merchant-ai-notice-update'\)/,
    )
    expect(shell).toMatch(/permissions\.can\('ai.manage'\)/)
    expect(shell).not.toContain('server/merchant-ai-notice-updates')
    expect(shell).not.toContain('getMerchantAiNoticeUpdateFn')
    expect(body).toContain("role === 'AccountAdmin'")
    expect(body).toContain('useQuery(')
  })
  it('keeps receipts in a user-and-organization Query cache and on the server', () => {
    expect(query).toMatch(
      /identityKeys\.merchantAiNotice\(\)\s*,\s*'updates',\s*userId,\s*organizationId/,
    )
    expect(client).toContain('markMerchantAiNoticeUpdateSeenFn(')
    expect(markSeen).toContain(
      'client.setQueryData(merchantAiNoticeUpdateKey(scope), null)',
    )
    expect(body + query + markSeen + client).not.toContain('localStorage')
  })
  it('imports the server module only in the route layer, lazily', () => {
    expect(client).toContain(
      "import('#/contexts/identity/server/merchant-ai-notice-updates')",
    )
    expect(client).not.toMatch(/^import .*server\/merchant-ai-notice-updates/mu)
    expect(query + markSeen).not.toContain('contexts/identity/server')
  })
  it("lets What's new read and mark the same update through the same options", () => {
    const whatsNew = '../../components/features/whats-new'
    const leading = read(`${whatsNew}/use-leading-ai-update.ts`)
    expect(body).toContain('merchantAiNoticeUpdateQuery(scope, getClient)')
    expect(body).toContain('useMarkMerchantAiNoticeUpdateSeen(scope, getClient)')
    expect(leading).toContain('merchantAiNoticeUpdateQuery(scope, getAiClient)')
    expect(leading).toContain('useMarkMerchantAiNoticeUpdateSeen(scope, getAiClient)')
  })
})
