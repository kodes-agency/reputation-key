// BQR-0: Capability enforcement architecture test.
//
// Verifies that:
// 1. Server functions in dark contexts import and call capability assertions.
// 2. Worker schedules for dark/blocked capabilities are gated.
// 3. Bootstrap registers those jobs through capability-gated helpers.
//
// Per BQR master plan §3.3: "No third state is permitted. A capability
// cannot be considered 'off' merely because navigation is hidden."

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DARK_CONTEXT_CAPABILITIES,
  PORTAL_DARK_CAPABILITIES,
  isCoreCapability,
} from './beta-capabilities'
import {
  JOB_OPERATIONAL_CONTRACTS,
  createOperationalSchedulerPlan,
} from '#/shared/jobs/operational-catalogue'

const SERVER_DIR = join(process.cwd(), 'src', 'contexts')
const WORKER_PATH = join(process.cwd(), 'src', 'worker', 'index.ts')
const BOOTSTRAP_PATH = join(process.cwd(), 'src', 'bootstrap.ts')

function getServerFiles(context: string): string[] {
  const dir = join(SERVER_DIR, context, 'server')
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

describe('BQR-0: Dark context capability enforcement', () => {
  for (const [context, capability] of Object.entries(DARK_CONTEXT_CAPABILITIES)) {
    const files = getServerFiles(context)

    if (files.length === 0) continue

    describe(`${context} server functions`, () => {
      for (const file of files) {
        const basename = file.split('/').pop()!
        const content = readFileSync(file, 'utf-8')

        // Skip utility/helper files that don't export server functions
        if (!content.includes('createServerFn')) continue
        const hasAssert = /assert(Global|Beta)Capability/.test(content)
        const hasAuthorizeSeam =
          content.includes('requireExecutionAllowed') ||
          content.includes('requirePortalResourceScope') ||
          content.includes('requireMatchingPortalResourceScopes') ||
          content.includes('decidePublicExecution')

        it(`${basename} enforces capability via the ExecutionPolicy seam or assert*Capability`, () => {
          expect(
            hasAssert || hasAuthorizeSeam,
            `${basename} in controlled context "${context}" must use an ExecutionPolicy or capability assertion seam`,
          ).toBe(true)
        })

        it(`${basename} references dark capability '${capability}' (literal or mapped permission)`, () => {
          // Portal paths may assert portal.read | portal.write | portal.upload (BQC-0.2).
          const allowedCaps =
            context === 'portal' ? [...PORTAL_DARK_CAPABILITIES] : [capability]
          const hasLiteral = allowedCaps.some((cap) => content.includes(`'${cap}'`))
          const permissionPrefix = capability
            .replace(/\.use$/, '')
            .replace(/^portal\..*/, 'portal')
          const hasMappedPermission =
            hasAuthorizeSeam &&
            (content.includes(`'${permissionPrefix}.`) ||
              content.includes(`"${permissionPrefix}.`) ||
              allowedCaps.some((cap) => content.includes(`'${cap}'`)) ||
              (content.includes('GoalExecutionPolicy') &&
                content.includes('request.action')))
          expect(
            hasLiteral || hasMappedPermission,
            `${basename} in dark context "${context}" must reference one of [${allowedCaps.join(', ')}] or use requireExecutionAllowed with matching permissions`,
          ).toBe(true)
        })
      }
    })
  }

  it('does not treat controlled capabilities as core', () => {
    expect(isCoreCapability('portal.read')).toBe(false)
    expect(isCoreCapability('portal.write')).toBe(false)
    expect(isCoreCapability('portal.upload')).toBe(false)
    expect(isCoreCapability('goal.use')).toBe(false)
  })
})

describe('BQR-0: Dark job / schedule containment', () => {
  const workerSrc = readFileSync(WORKER_PATH, 'utf-8')
  const bootstrapSrc = readFileSync(BOOTSTRAP_PATH, 'utf-8')

  it('worker delegates recurring schedules to the governed operational authority', () => {
    expect(workerSrc).toContain('createOperationalSchedulerPlan()')
    expect(workerSrc).toContain('schedulerPlan.desired')
  })

  it('operational authority omits retired Recognition work and retains active gates', () => {
    expect(
      JOB_OPERATIONAL_CONTRACTS.find((row) => row.jobName === 'leaderboard.reconcile'),
    ).toBeUndefined()
    expect(
      JOB_OPERATIONAL_CONTRACTS.find((row) => row.jobName === 'digest-notification'),
    ).toMatchObject({ capability: 'notification.send_email', posture: 'active' })
    expect(
      JOB_OPERATIONAL_CONTRACTS.find(
        (row) => row.jobName === 'portal-approved-destination-revalidation',
      ),
    ).toMatchObject({ capability: 'portal.write', posture: 'active' })
    expect(
      JOB_OPERATIONAL_CONTRACTS.find(
        (row) => row.jobName === 'portal-upload-source-cleanup',
      ),
    ).toMatchObject({ capability: 'none', posture: 'active' })
    const desired = createOperationalSchedulerPlan().desired.map(
      (schedule) => schedule.jobName,
    )
    expect(desired).not.toContain('leaderboard.reconcile')
    expect(desired).toContain('digest-notification')
    expect(desired).toContain('portal-approved-destination-revalidation')
    expect(desired).toContain('portal-upload-source-cleanup')
  })

  it('bootstrap routes controlled jobs through a registration gate', () => {
    expect(bootstrapSrc).toContain('registerCapabilityGatedJob')
    expect(bootstrapSrc).toContain('job handler not registered (capability dark/blocked)')
    expect(bootstrapSrc).not.toContain('registered no-op job handler')
    // Match job name + capability even if prettier wraps arguments across lines
    const gated = (job: string, cap: string) => {
      const re = new RegExp(
        `registerCapabilityGatedJob\\(\\s*${job}\\s*,\\s*'${cap}'`,
        'm',
      )
      expect(bootstrapSrc, `expected gated job ${job} / ${cap}`).toMatch(re)
    }
    expect(bootstrapSrc).not.toContain("'leaderboard.reconcile'")
    gated('PORTAL_DESTINATION_REVALIDATION_JOB', 'portal.write')
    gated('PROCESS_IMAGE_JOB_NAME', 'portal.upload')
    gated('URGENT_EMAIL_JOB_NAME', 'notification.send_email')
    gated('DIGEST_JOB_NAME', 'notification.send_email')
    expect(bootstrapSrc).toContain(
      'container.jobRegistry.register(\n    PORTAL_UPLOAD_SOURCE_CLEANUP_JOB',
    )
  })

  it('outbox dispatcher remains opt-in', () => {
    expect(workerSrc).toContain('OUTBOX_DISPATCHER_ENABLED')
  })
})
