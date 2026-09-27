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
    // The sweep consumes Integration's named worker capability; bootstrap
    // builds no recovery repository of its own.
    expect(bootstrap).not.toContain('createGoogleOAuthExchangeRecoveryRepository')
    expect(bootstrap).not.toContain('createGoogleDisconnectRevokeRepository')
    const sweep = bootstrap.slice(
      bootstrap.indexOf(
        'container.jobRegistry.register(PERMIT_START_DEADLINE_SWEEP_JOB_NAME',
      ),
      bootstrap.indexOf("'Google provider recovery sweep completed'"),
    )
    expect(sweep).toMatch(
      /integrationWorkerRuntime\.reconcileProviderRecovery\(\{\s*now: container\.clock\(\),\s*limit: 100,?\s*\}\)/u,
    )
    // That capability runs both stores the build holds (see
    // reconcile-google-provider-recovery.test.ts for the delegation).
    expect(source('src/contexts/integration/build.ts')).toMatch(
      /reconcileProviderRecovery: reconcileGoogleProviderRecovery\(\{\s*exchangeRecovery: googleOAuthExchangeRecovery,\s*disconnectRevoke: googleDisconnectRevokeStore,?\s*\}\)/u,
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
