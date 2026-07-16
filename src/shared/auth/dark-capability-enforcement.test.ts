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
import { DARK_CONTEXT_CAPABILITIES, isCoreCapability } from './beta-capabilities'

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

        it(`${basename} imports a capability assertion`, () => {
          expect(
            content.match(/assert(Global|Beta)Capability/),
            `${basename} in dark context "${context}" must import and call assertBetaCapability or assertGlobalCapability`,
          ).not.toBeNull()
        })

        it(`${basename} references capability '${capability}'`, () => {
          expect(
            content,
            `${basename} in dark context "${context}" must reference '${capability}'`,
          ).toContain(capability)
        })
      }
    })
  }

  it('does not treat dark portal.read as a core capability', () => {
    expect(isCoreCapability('portal.read')).toBe(false)
    expect(isCoreCapability('goal.use')).toBe(false)
    expect(isCoreCapability('badge.use')).toBe(false)
    expect(isCoreCapability('leaderboard.use')).toBe(false)
    expect(isCoreCapability('team.use')).toBe(false)
  })
})

describe('BQR-0: Dark job / schedule containment', () => {
  const workerSrc = readFileSync(WORKER_PATH, 'utf-8')
  const bootstrapSrc = readFileSync(BOOTSTRAP_PATH, 'utf-8')

  it('worker imports isCapabilityJobEnabled for schedule gating', () => {
    expect(workerSrc).toContain('isCapabilityJobEnabled')
  })

  it('worker schedules dark jobs only after capability check', () => {
    expect(workerSrc).toContain("capability: 'goal.use'")
    expect(workerSrc).toContain("capability: 'badge.use'")
    expect(workerSrc).toContain("capability: 'leaderboard.use'")
    expect(workerSrc).toContain("capability: 'notification.send_email'")
    expect(workerSrc).toContain('isCapabilityJobEnabled(capability)')
  })

  it('bootstrap registers dark jobs via registerCapabilityGatedJob', () => {
    expect(bootstrapSrc).toContain('registerCapabilityGatedJob')
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob(RECONCILE_GOAL_JOB_NAME, 'goal.use'",
    )
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob(SPAWN_RECURRING_JOB_NAME, 'goal.use'",
    )
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob('badge.reconcile', 'badge.use'",
    )
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob('leaderboard.reconcile', 'leaderboard.use'",
    )
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob(PROCESS_IMAGE_JOB_NAME, 'portal.upload'",
    )
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob(URGENT_EMAIL_JOB_NAME, 'notification.send_email'",
    )
    expect(bootstrapSrc).toContain(
      "registerCapabilityGatedJob(DIGEST_JOB_NAME, 'notification.send_email'",
    )
  })

  it('outbox dispatcher remains opt-in', () => {
    expect(workerSrc).toContain('OUTBOX_DISPATCHER_ENABLED')
  })
})
