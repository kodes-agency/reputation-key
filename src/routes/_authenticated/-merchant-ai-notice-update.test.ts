import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('shell AI update gate', () => {
  const shell = readFileSync(new URL('../_authenticated.tsx', import.meta.url), 'utf8')
  const body = readFileSync(
    new URL('./-merchant-ai-notice-update.tsx', import.meta.url),
    'utf8',
  )
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
    expect(body).toMatch(
      /identityKeys\.merchantAiNotice\(\)\s*,\s*'updates',\s*userId,\s*organizationId/,
    )
    expect(body).toContain('markMerchantAiNoticeUpdateSeenFn(')
    expect(body).toContain('client.setQueryData(queryKey, null)')
    expect(body).not.toContain('localStorage')
  })
})
