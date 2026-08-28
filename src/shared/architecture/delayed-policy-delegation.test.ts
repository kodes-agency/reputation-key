// BQC-3.2 — delayed policy delegation architecture test.
//
// The dispatch gate (src/shared/jobs/delayed-execution-gate.ts) is the SINGLE
// decision point for delayed execution (phase BQC-3: JobRuntime must not
// contain duplicate capability rules). Job handler files must therefore not
// re-check capabilities directly — the BQC-0.4 in-handler stop controls were
// superseded by the gate. Registration-time gates (bootstrap.ts
// registerCapabilityGatedJob, worker scheduling gates) are the allowed
// exception; this scan covers job handler files only.

import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from '#/shared/testing/source-tree'
import { createContainer } from '#/composition'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { getDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'

const ROOT = process.cwd()

describe('BQC-3.2 delayed policy delegation', () => {
  it('no *.job.ts handler file imports or calls the capability gate directly', () => {
    const jobFiles = walk(join(ROOT, 'src/contexts')).filter(
      (f) => f.endsWith('.job.ts') && !f.endsWith('.test.ts'),
    )
    expect(jobFiles.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const abs of jobFiles) {
      const content = readFileSync(abs, 'utf8')
      const importsGate = content.includes('#/shared/auth/beta-capabilities')
      const callsGate =
        /(?:checkGlobalCapability|checkBetaCapability|isCapabilityJobEnabled)\s*\(/.test(
          content,
        )
      if (importsGate || callsGate) offenders.push(relative(ROOT, abs))
    }

    expect(
      offenders,
      `job handlers must delegate to the dispatch gate (BQC-3.2), not re-check capabilities:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// ARC-03-T8 — two containers in one process own DISTINCT policy objects, and
// only the explicitly bound one answers the process reads. Before this, the
// second container's build silently re-installed the singletons.
describe('ARC-03-T8 container-owned policy objects', () => {
  const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')
  const clock: Clock = () => FIXED_DATE

  /** Query-free guard: any DB access during construction throws. */
  const dbStub = new Proxy(
    {},
    {
      get: () => {
        throw new Error('composition must not query the DB during construction')
      },
    },
  ) as unknown as Database

  function build() {
    clearEventSchemas()
    return createContainer({
      clock,
      queue: createInMemoryQueue({ clock }),
      backgroundQueue: createInMemoryQueue({ clock }),
      opsDomainEventsQueue: createInMemoryQueue({ clock }),
      opsQuarantineQueue: createInMemoryQueue({ clock }),
      redis: undefined,
      enableJobs: true,
      db: dbStub,
      identityPort: createInMemoryIdentityPort(),
      email: async () => {},
    })
  }

  afterEach(() => {
    releaseProcessPolicies()
  })

  it('gives each container its own policies and answers only from the bound one', async () => {
    releaseProcessPolicies()
    const first = build()
    const second = build()

    expect(first.executionPolicy).not.toBe(second.executionPolicy)
    expect(first.delayedExecutionPolicy).not.toBe(second.delayedExecutionPolicy)
    expect(first.capabilityPolicyStore).not.toBe(second.capabilityPolicyStore)

    bindProcessPolicies(first)
    expect(getExecutionPolicy()).toBe(first.executionPolicy)
    expect(getDelayedExecutionPolicy()).toBe(first.delayedExecutionPolicy)
    expect(() => bindProcessPolicies(second)).toThrow('[PROCESS POLICY] already bound')
    expect(getExecutionPolicy()).not.toBe(second.executionPolicy)

    await first.shutdown.run()
    await second.shutdown.run()
  })
})
