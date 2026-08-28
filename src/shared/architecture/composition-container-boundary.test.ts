import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function directlyAccessedRepositories(source: string): string[] {
  return [...source.matchAll(/\bcontainer\.([A-Za-z][A-Za-z0-9]*Repo)\b/gu)].map(
    ([, repository]) => repository!,
  )
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/u.test(entry.name) ? [path] : []
  })
}

describe('composition container boundary evidence', () => {
  it('detects a deliberately exposed infrastructure repository', () => {
    expect(
      directlyAccessedRepositories(
        'export const load = () => container.reviewRepo.findById("review-1")',
      ),
    ).toEqual(['reviewRepo'])
  })

  it('routes the AI server through context public APIs instead of the Review repository', () => {
    const aiServer = readFileSync(
      resolve('src/contexts/ai/server/reply-suggestion.ts'),
      'utf8',
    )
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(directlyAccessedRepositories(aiServer)).toEqual([])
    expect(aiServer).toContain('container.reviewPublicApi.aiReviewSource')
    expect(aiServer).toContain('container.aiPublicApi.generateReplySuggestion')
    expect(composition).toContain('reviewPublicApi: review.publicApi')
    expect(composition).toContain('aiPublicApi: ai.publicApi')
  })

  it('keeps simulation tooling behind narrow capabilities instead of repositories', () => {
    const root = process.cwd()
    const testPath = 'src/shared/architecture/composition-container-boundary.test.ts'
    const directConsumers = sourceFiles(resolve('src'))
      .map((path) => relative(root, path))
      .filter((path) => path !== testPath)
      .filter((path) => /\bcontainer\.reviewRepo\b/u.test(readFileSync(path, 'utf8')))
      .sort()

    expect(directConsumers).toEqual([])
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')
    const simulationContainer = readFileSync(
      resolve('src/shared/testing/simulation-container.server.ts'),
      'utf8',
    )
    const simulationAuthorityConsumers = sourceFiles(resolve('src'))
      .map((path) => relative(root, path))
      .filter((path) => path !== testPath)
      .filter((path) =>
        readFileSync(resolve(path), 'utf8').includes('exposeSimulationRuntime: true'),
      )
      .sort()
    expect(composition).toContain('simulationRuntime: Object.freeze({')
    expect(composition).toContain('options?.exposeSimulationRuntime')
    expect(simulationContainer).toContain('exposeSimulationRuntime: true')
    expect(simulationAuthorityConsumers).toEqual([
      'src/shared/testing/simulation-container.server.ts',
    ])
    expect(composition).not.toMatch(/^\s+reviewRepo:/gmu)
    expect(composition).not.toMatch(/^\s+replyRepo:/gmu)
    expect(composition).not.toMatch(/^\s+inboxRepo:/gmu)
  })

  it('routes operator reconciliation through a bounded capability', () => {
    const operatorScript = readFileSync(
      resolve('scripts/ops/reconcile-publication.ts'),
      'utf8',
    )
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(directlyAccessedRepositories(operatorScript)).toEqual([])
    expect(operatorScript).toContain(
      'container.reviewMaintenanceRuntime.publicationReconciliation',
    )
    expect(operatorScript).toContain('.findCandidates')
    expect(operatorScript).toContain('.reconcile')
    expect(operatorScript).not.toContain('/ports/reply.repository')
    expect(operatorScript).not.toContain('/domain/types')
    expect(composition).toContain('reviewMaintenanceRuntime: review.maintenance')
    expect(composition).not.toContain('publicationReconciliationRuntime')
  })

  it('keeps restore-only Review construction behind the Review maintenance runtime', () => {
    const restoreVerify = readFileSync(resolve('scripts/ops/restore-verify.ts'), 'utf8')

    expect(restoreVerify).toContain(
      'container.reviewMaintenanceRuntime.recovery.createAuthority',
    )
    expect(restoreVerify).not.toContain('/contexts/review/infrastructure/')
    expect(restoreVerify).not.toContain('/contexts/review/application/use-cases/')
    expect(restoreVerify).not.toContain('loadReviewLifecycleRecoveryApprovalPublicKeys')
  })

  it('routes Integration review admission through Review public capability', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(composition).toContain('review.publicApi.syncAdmission.addSyncJob')
    expect(composition).toContain('review.publicApi.syncAdmission.addTargetedFetchJob')
    expect(composition).not.toContain('review.internal.repos.queue.addSyncJob')
    expect(composition).not.toContain(
      'review.internal.repos.targetedQueue.addTargetedFetchJob',
    )
  })

  it('keeps provider runtime construction in a deterministic root-owned module', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')
    const providerRuntime = readFileSync(
      resolve('src/composition/provider-runtime.ts'),
      'utf8',
    )

    expect(composition).toContain("from './composition/provider-runtime'")
    expect(composition).not.toContain('https://oauth2.googleapis.com/token')
    expect(providerRuntime).toContain('https://oauth2.googleapis.com/token')
    expect(providerRuntime).not.toContain('process.env')
  })

  it('delegates root infrastructure and policy provisioning to cohesive builders', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')
    const infrastructure = readFileSync(
      resolve('src/composition/infrastructure.ts'),
      'utf8',
    )
    const policyProvisioning = readFileSync(
      resolve('src/composition/property-capability-provisioning.ts'),
      'utf8',
    )

    expect(composition).toContain("from './composition/infrastructure'")
    expect(composition).toContain("from './composition/property-capability-provisioning'")
    expect(infrastructure).toContain('export function buildInfrastructure')
    expect(policyProvisioning).toContain(
      'export function bindPropertyCapabilityProvisioning',
    )
  })

  it('delegates Review worker wiring through one context-owned registration capability', () => {
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(bootstrap).toContain('await container.registerReviewWorkerJobs({')
    expect(
      directlyAccessedRepositories(bootstrap).filter((name) =>
        ['reviewRepo', 'replyRepo'].includes(name),
      ),
    ).toEqual([])
    expect(bootstrap).not.toContain('container.reviewQueue')
    expect(composition).toContain('review.internal.registerWorkerJobs({')
    expect(composition).not.toContain('replyCommandStore: review.internal')
    expect(composition).not.toContain('reviewQueue: review.internal')
    expect(composition).not.toContain('replyQueue: review.internal')
  })

  it('registers Inbox reminder release through a named context runtime', () => {
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(composition).toContain('inboxRuntime: Object.freeze({')
    expect(composition).toContain('releaseDueResponseTargetReminders,')
    expect(bootstrap).toContain(
      'container.inboxRuntime.releaseDueResponseTargetReminders',
    )
    expect(bootstrap).not.toContain(
      'container.useCases.releaseDueResponseTargetReminders',
    )
  })

  it('registers context consumers through narrow worker capabilities', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')
    const contextVariables = [
      'activity',
      'ai',
      'goal',
      'inbox',
      'integration',
      'metricApi',
      'notification',
      'portal',
      'property',
      'review',
    ] as const

    for (const context of contextVariables) {
      expect(composition).toContain(`${context}.worker.registerOutboxConsumers`)
      expect(composition).not.toContain(`${context}.internal.registerOutboxConsumers`)
    }
  })

  it('routes Review server adapters through the Review public API', () => {
    const reviewServers = [
      'src/contexts/review/server/reply.ts',
      'src/contexts/review/server/reply-draft.ts',
      'src/contexts/review/server/reply-read.ts',
      'src/contexts/review/server/staff-recent-activity.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))

    for (const server of reviewServers) {
      expect(server).not.toContain('container.useCases')
      expect(server).not.toContain('const { useCases } = getContainer()')
    }
    expect(reviewServers.join('\n')).toContain('reviewPublicApi.reply')
  })

  it('routes Inbox request adapters and real-logic stories through the Inbox public API', () => {
    const inboxServers = [
      'src/contexts/inbox/server/inbox-feedback-handling.ts',
      'src/contexts/inbox/server/inbox-item-actions.ts',
      'src/contexts/inbox/server/inbox-item-queries.ts',
      'src/contexts/inbox/server/inbox-queries.ts',
      'src/contexts/inbox/server/inbox-response-targets.ts',
      'src/contexts/inbox/server/inbox-status.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))
    const storyConsumers = [
      '.storybook/in-memory/inbox-container.ts',
      '.storybook/in-memory/inbox-fns.ts',
      'src/components/inbox/inbox-real-logic.stories.tsx',
    ].map((path) => readFileSync(resolve(path), 'utf8'))
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(inboxServers.join('\n')).toContain('inboxPublicApi')
    expect([...inboxServers, ...storyConsumers].join('\n')).not.toContain(
      'container.useCases',
    )
    expect(composition).toContain('inboxPublicApi: inbox.publicApi')
  })

  it('separates Inbox lifecycle workflows from bounded operator maintenance', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')
    const rebuildScript = readFileSync(
      resolve('scripts/ops/rebuild-projection.ts'),
      'utf8',
    )

    expect(composition).toContain('inboxLifecycleRuntime: inbox.lifecycle')
    expect(composition).toContain('inboxMaintenanceRuntime: inbox.maintenance')
    expect(rebuildScript).toContain(
      'container.inboxMaintenanceRuntime.rebuildInboxProjection',
    )
    expect(rebuildScript).not.toContain('container.useCases')
  })

  it('does not expose or consume a catch-all container use-case locator', () => {
    const root = process.cwd()
    const productionFiles = [resolve('src'), resolve('scripts')]
      .flatMap(sourceFiles)
      .map((path) => relative(root, path))
      .filter((path) => !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/u.test(path))
    const consumers = productionFiles.filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /\b(?:container|getContainer\(\))\.useCases\b/u.test(source)
    })
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(consumers).toEqual([])
    expect(composition).not.toMatch(/^\s{4}useCases:\s*\{/mu)
  })

  it('routes Dashboard property facts through the Property public API', () => {
    const dashboardServers = [
      'src/contexts/dashboard/server/dashboard.ts',
      'src/contexts/dashboard/server/portal-analytics.ts',
      'src/contexts/dashboard/server/staff-dashboard.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))

    expect(dashboardServers.join('\n')).not.toContain('propertyProcessingScopeApi')
    expect(dashboardServers.join('\n')).toContain('propertyPublicApi')
    expect(readFileSync(resolve('src/composition.ts'), 'utf8')).toContain(
      'propertyPublicApi: property.publicApi',
    )
  })

  it('routes AI and Dashboard request adapters through context public APIs', () => {
    const aiServers = [
      'src/contexts/ai/server/property-aggregates.ts',
      'src/contexts/ai/server/property-trend.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))
    const dashboardServers = [
      'src/contexts/dashboard/server/dashboard.ts',
      'src/contexts/dashboard/server/fleet-overview.ts',
      'src/contexts/dashboard/server/portal-analytics.ts',
      'src/contexts/dashboard/server/setup-checklist.ts',
      'src/contexts/dashboard/server/staff-dashboard.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(aiServers.join('\n')).toContain('aiPublicApi')
    expect(dashboardServers.join('\n')).toContain('dashboardPublicApi')
    expect([...aiServers, ...dashboardServers].join('\n')).not.toContain('.useCases')
    expect(composition).toContain('dashboardPublicApi: dashboard.publicApi')
  })

  it('routes AI job handlers through an AI-owned worker capability', () => {
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(bootstrap).toContain('container.aiWorkerRuntime.generatePropertyTrend')
    expect(bootstrap).toContain('container.aiWorkerRuntime.schedulePropertyTrends')
    expect(bootstrap).toContain(
      'container.aiWorkerRuntime.advanceReviewAnalysisBackfill.sweep',
    )
    expect(bootstrap).toContain(
      'container.aiWorkerRuntime.advanceReviewAnalysisEnrollments.sweep',
    )
    expect(bootstrap).not.toContain('container.useCases.generatePropertyTrend')
    expect(composition).toContain('aiWorkerRuntime: ai.worker')
  })

  it('keeps Goal request and maintenance entry points behind owned capabilities', () => {
    const goalServer = readFileSync(
      resolve('src/contexts/goal/server/goal-programs.ts'),
      'utf8',
    )
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(goalServer).toContain('goalPublicApi.programs')
    expect(goalServer).not.toContain('.useCases')
    expect(bootstrap).toContain('goalWorkerRuntime.programMaintenance')
    expect(bootstrap).not.toContain('useCases.createGoalProgramService')
    expect(composition).toContain('goalPublicApi: goal.publicApi')
    expect(composition).toContain('goalWorkerRuntime: goal.worker')
    expect(composition).not.toContain('...goal.internal.useCases')
  })

  it('routes Portal requests and maintenance through Portal-owned capabilities', () => {
    const portalServers = sourceFiles(resolve('src/contexts/portal/server')).map((path) =>
      readFileSync(path, 'utf8'),
    )
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(portalServers.join('\n')).toContain('portalPublicApi.management')
    expect(portalServers.join('\n')).not.toContain('getContainer().useCases')
    expect(bootstrap).toContain(
      'container.portalWorkerRuntime.revalidateApprovedDestinations',
    )
    expect(composition).not.toContain('...portal.internal.useCases')
  })

  it('routes the Guest public edge through Guest-owned request capabilities', () => {
    const guestServers = [
      'src/contexts/guest/server/guest-scans.ts',
      'src/contexts/guest/server/public.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(guestServers.join('\n')).toContain('guestPublicApi.requests')
    expect(guestServers.join('\n')).not.toContain('getContainer().useCases')
    expect(composition).toContain('guestPublicApi: guest.publicApi')
    expect(composition).not.toContain('...guest.internal.useCases')
  })

  it('routes Staff request adapters through the Staff public API', () => {
    const staffServers = sourceFiles(resolve('src/contexts/staff/server')).map((path) =>
      readFileSync(path, 'utf8'),
    )
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(staffServers.join('\n')).toContain('staffPublicApi.management')
    expect(staffServers.join('\n')).not.toContain('getContainer().useCases')
    expect(composition).not.toContain('...staff.internal.useCases')
  })

  it('routes Property request adapters through Property-owned capabilities', () => {
    const propertyServers = sourceFiles(resolve('src/contexts/property/server')).map(
      (path) => readFileSync(path, 'utf8'),
    )
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')
    const propertyBuild = readFileSync(resolve('src/contexts/property/build.ts'), 'utf8')

    expect(propertyServers.join('\n')).toContain('propertyPublicApi.management')
    expect(propertyServers.join('\n')).not.toContain('getContainer().useCases')
    expect(composition).not.toContain('...property.internal.useCases')
    expect(propertyBuild).not.toContain('softDeleteProperty:')
  })

  it('routes Integration entry points through workflow-specific capabilities', () => {
    const requestServers = sourceFiles(resolve('src/contexts/integration/server')).map(
      (path) => readFileSync(path, 'utf8'),
    )
    const oauthCallback = readFileSync(
      resolve('src/routes/api/auth/google/callback.ts'),
      'utf8',
    )
    const webhook = readFileSync(
      resolve('src/routes/api/webhooks/gbp/notifications.ts'),
      'utf8',
    )
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const operatorScripts = [
      'scripts/ops/disconnect-connection.ts',
      'scripts/ops/gbp-subscribe.ts',
      'scripts/ops/google-import-lifecycle.ts',
      'scripts/ops/restore-verify.ts',
    ].map((path) => readFileSync(resolve(path), 'utf8'))
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(requestServers.join('\n')).toContain('integrationPublicApi')
    expect(oauthCallback).toContain('integrationPublicApi.oauth')
    expect(webhook).toContain('integrationWebhookRuntime.handleNotification')
    expect(bootstrap).toContain('integrationWorkerRuntime.processImportItem')
    expect(bootstrap).toContain('integrationWorkerRuntime.sweepImportLifecycle')
    expect(operatorScripts.join('\n')).toContain('integrationMaintenanceRuntime')
    expect(operatorScripts.join('\n')).toContain('integrationPublicApi.connections')
    expect(
      [...requestServers, oauthCallback, webhook, bootstrap, ...operatorScripts].join(
        '\n',
      ),
    ).not.toContain('container.useCases')
    expect(composition).toContain('integrationPublicApi: integration.publicApi')
    expect(composition).toContain('integrationWorkerRuntime: integration.worker')
    expect(composition).toContain(
      'integrationMaintenanceRuntime: integration.maintenance',
    )
    expect(composition).toContain('integrationLifecycleRuntime: integration.lifecycle')
    expect(composition).toContain('integrationWebhookRuntime: integration.webhook')
    expect(composition).not.toContain('...integration.internal.useCases')
  })

  it('routes Metric projection repair through a context-owned maintenance capability', () => {
    const operatorScript = readFileSync(
      resolve('scripts/ops/rebuild-metric-projection.ts'),
      'utf8',
    )
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(operatorScript).toContain(
      'getContainer().metricMaintenanceRuntime.repairPortalLifetime',
    )
    expect(operatorScript).not.toContain('getContainer().useCases')
    expect(composition).toContain('metricMaintenanceRuntime: metricApi.maintenance')
    expect(composition).not.toContain('repairPortalLifetime: metricApi.internal.useCases')

    const metricBuild = readFileSync(resolve('src/contexts/metric/build.ts'), 'utf8')
    const metricPublicApi = readFileSync(
      resolve('src/contexts/metric/application/public-api.ts'),
      'utf8',
    )
    expect(metricBuild).toContain(
      'portalLifetime: Object.freeze({ get: portalLifetime.get })',
    )
    expect(metricPublicApi).toContain('portalLifetime: PortalLifetimeReadApi')
    expect(metricPublicApi).not.toContain('portalLifetime: PortalLifetimeAggregatePort')
  })

  it('routes Identity requests and recovery through owned capabilities', () => {
    const identityServers = sourceFiles(resolve('src/contexts/identity/server')).map(
      (path) => readFileSync(path, 'utf8'),
    )
    const bootstrap = readFileSync(resolve('src/bootstrap.ts'), 'utf8')
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(identityServers.join('\n')).toContain('identityPublicApi.requests')
    expect(identityServers.join('\n')).not.toContain('getContainer().useCases')
    expect(identityServers.join('\n')).not.toContain('const { useCases')
    expect(bootstrap).toContain(
      'container.identityWorkerRuntime.recoverInvitedRegistrations',
    )
    expect(composition).toContain('identityPublicApi: identity.publicApi')
    expect(composition).toContain('identityWorkerRuntime: identity.worker')
    expect(composition).not.toContain('...identity.internal.useCases')
  })
})
