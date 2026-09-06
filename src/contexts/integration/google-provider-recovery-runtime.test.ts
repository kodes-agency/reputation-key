import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Google provider recovery runtime', () => {
  it('runs both bounded recovery stores from the enabled five-minute permit sweep', () => {
    const bootstrap = source('src/bootstrap.ts')
    const schedule = JOB_FAMILY_ROWS.find(
      (row) => row.jobName === 'permit-start-deadline-sweep',
    )

    expect(schedule).toMatchObject({
      queue: 'background',
      capability: 'none',
      schedule: 'every:300000',
      registration: 'enabled',
    })
    expect(bootstrap).toMatch(
      /createGoogleOAuthExchangeRecoveryRepository\(\s*container\.db,?\s*\)/u,
    )
    expect(bootstrap).toMatch(
      /createGoogleDisconnectRevokeRepository\(\s*container\.db,?\s*\)/u,
    )
    expect(bootstrap).toContain('oauthExchangeRecovery.expire({ now, limit: 100 })')
    expect(bootstrap).toContain(
      'disconnectRevokeRecovery.reconcileElapsed({ now, limit: 100 })',
    )
  })

  it('keeps recovery observability content-free', () => {
    const bootstrap = source('src/bootstrap.ts')
    const recoveryBlock = bootstrap.slice(
      bootstrap.indexOf('oauthExchangeAttemptsExpired'),
      bootstrap.indexOf("'Google provider recovery sweep completed'") + 43,
    )

    expect(recoveryBlock).not.toMatch(
      /organization|connectionId|attemptId|permitId|credentialBinding|token|providerResponse/u,
    )
  })
})
