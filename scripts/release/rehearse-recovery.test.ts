import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runRehearseRecoveryCli } from './rehearse-recovery'
import {
  buildRecoveryRehearsalPlan,
  type RecoveryRehearsalPlanInput,
} from '../../src/shared/release/recovery-rehearsal-plan'
import {
  parseRecoveryRehearsalEvidence,
  recoveryRehearsalDependencyDigests,
} from '../../src/shared/release/recovery-rehearsal-evidence'
import { releaseEvidenceSha256 } from '../../src/shared/release/candidate-bound-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'

const CANDIDATE = {
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  cell: 'us',
  environment: 'cell-us',
  deploymentProfile: 'production',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  projectId: 'project-id',
  environmentId: 'environment-id',
  appOrigin: 'https://us.reputationkey.app',
} as const

const OPERATOR = {
  identity: 'operating-owner:beta-oncall',
  changeRecord: 'CHG-2026-08-28-01',
  independentReviewer: 'operating-owner:platform',
  reviewedAt: '2026-08-27T12:00:00.000Z',
} as const

const reference = (seed: string) => ({
  sha256: releaseEvidenceSha256(seed),
  capturedAt: '2026-08-27T12:00:00.000Z',
})

const redis = (seed: string) => ({
  serviceId: `redis-${seed}`,
  createdAt: '2026-08-28T00:30:00.000Z',
  emptyState: reference(`empty-${seed}`),
})

const SEEDS = [
  'final-manifest',
  'compatibility',
  'containment',
  'restore-plan',
  'restore-approval',
  'platform-receipt',
  'fence',
  'lifecycle',
  'migration-head',
  'tenant-isolation',
  'empty-cache',
  'empty-queue',
  'empty-provider',
  'sibling-cutover',
  'sibling-readback',
  'source-rollback',
  'source-readback',
  'forward-decision',
  'forward-readback',
  'post-recovery-journeys',
  'alerts',
]

function observations(): string {
  return `${JSON.stringify({
    recoveryPath: 'incompatible_data_restore',
    candidate: CANDIDATE,
    rehearsalRunId: '00000000-0000-4000-8000-000000000011',
    startedAt: '2026-08-28T00:00:00.000Z',
    completedAt: '2026-08-28T02:00:00.000Z',
    capturedAt: '2026-08-28T02:30:00.000Z',
    operator: OPERATOR,
    compatibilityDecision: reference('compatibility'),
    containment: {
      customerTrafficStopped: true,
      mutationsStopped: true,
      workersStopped: true,
      externalEffectsStopped: true,
      evidence: reference('containment'),
    },
    schemaBackwardCompatible: false,
    restore: {
      reviewedRestorePlan: reference('restore-plan'),
      reviewedPlanApproval: reference('restore-approval'),
      platformReceipt: reference('platform-receipt'),
      sourcePostgresServiceId: 'postgres-source',
      siblingPostgresServiceId: 'postgres-sibling',
      restorePointAt: '2026-08-28T00:05:00.000Z',
      latestCommittedAt: '2026-08-28T00:10:00.000Z',
      restoreStartedAt: '2026-08-28T00:15:00.000Z',
      readinessRecoveredAt: '2026-08-28T01:15:00.000Z',
      recoveryRunId: '00000000-0000-4000-8000-000000000012',
      recoveryGeneration: 2,
      recoveryFence: reference('fence'),
      lifecycleVerification: reference('lifecycle'),
      migrationHeadVerification: reference('migration-head'),
      tenantIsolationAndCriticalReads: reference('tenant-isolation'),
      freshRedis: {
        cache: redis('cache'),
        queue: redis('queue'),
        provider: redis('provider'),
      },
    },
    routingRehearsal: {
      siblingCutoverPlan: reference('sibling-cutover'),
      siblingReadback: reference('sibling-readback'),
      sourceRollbackPlan: reference('source-rollback'),
      sourceReadback: reference('source-readback'),
      customerTrafficStoppedThroughout: true,
      mutationsStoppedThroughout: true,
      externalEffectsStoppedThroughout: true,
    },
    forwardRecovery: {
      strategy: 'restored_sibling',
      finalReleaseManifestSha256: releaseEvidenceSha256('final-manifest'),
      decision: reference('forward-decision'),
      finalReadback: reference('forward-readback'),
      postRecoveryJourneys: reference('post-recovery-journeys'),
    },
    verification: {
      readinessGreen: true,
      canaryReadPassed: true,
      queueOutboxConsistent: true,
      committedSourceIntegrityPassed: true,
      alertReceipts: reference('alerts'),
      committedDataLossCount: 0,
      duplicateExternalEffectCount: 0,
      unsafeExternalEffectCount: 0,
    },
  })}\n`
}

const PLAN_INPUT: RecoveryRehearsalPlanInput = {
  recoveryPath: 'incompatible_data_restore',
  candidate: CANDIDATE,
  operator: OPERATOR,
  createdAt: '2026-08-27T13:00:00.000Z',
}

function io() {
  const written: string[] = []
  return {
    io: {
      out: (line: string) => written.push(line),
      err: (line: string) => written.push(line),
    },
    written,
  }
}

function applyWorkspace(
  overrides: Readonly<{ planSha256?: string }> = {},
): Readonly<{ dir: string; inputsDir: string; outDir: string; planPath: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'repkey-recovery-'))
  const inputsDir = join(dir, 'inputs')
  const outDir = join(dir, 'out')
  mkdirSync(inputsDir)
  mkdirSync(outDir)

  const plan = buildRecoveryRehearsalPlan(PLAN_INPUT)
  if (!plan.ok) throw new Error(plan.errors.join('\n'))
  const planPath = join(dir, 'plan.json')
  writeFileSync(planPath, plan.document)

  writeFileSync(
    join(dir, 'authorization.json'),
    `${JSON.stringify({
      version: 'repkey-recovery-rehearsal-authorization-1',
      planSha256: overrides.planSha256 ?? plan.digest,
      operator: OPERATOR.identity,
      reason: 'REL-01 isolated restore rehearsal',
      approvedAt: '2026-08-27T23:00:00.000Z',
    })}\n`,
  )
  writeFileSync(join(dir, 'observations.json'), observations())
  for (const seed of SEEDS) writeFileSync(join(inputsDir, `${seed}.txt`), seed)

  return { dir, inputsDir, outDir, planPath }
}

function applyArgs(
  space: ReturnType<typeof applyWorkspace>,
  omit: readonly string[] = [],
): readonly string[] {
  const flags: Record<string, string> = {
    '--plan-file': space.planPath,
    '--authorization': join(space.dir, 'authorization.json'),
    '--observations': join(space.dir, 'observations.json'),
    '--platform-receipt': join(space.inputsDir, 'platform-receipt.txt'),
    '--inputs-dir': space.inputsDir,
    '--operator': OPERATOR.identity,
    '--reason': 'REL-01 isolated restore rehearsal',
    '--output': join(space.outDir, 'recovery-rehearsal.json'),
  }
  return [
    '--apply',
    ...Object.entries(flags)
      .filter(([flag]) => !omit.includes(flag))
      .map(([flag, value]) => `${flag}=${value}`),
  ]
}

describe('rehearse-recovery --plan', () => {
  it('writes only the plan artifact and mutates nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repkey-recovery-plan-'))
    const candidatePath = join(dir, 'candidate.json')
    writeFileSync(candidatePath, `${JSON.stringify(CANDIDATE)}\n`)
    const outDir = join(dir, 'out')
    mkdirSync(outDir)
    const { io: sink, written } = io()

    const code = await runRehearseRecoveryCli(
      [
        '--plan',
        '--recovery-path=incompatible_data_restore',
        `--candidate=${candidatePath}`,
        `--operator=${OPERATOR.identity}`,
        `--change-record=${OPERATOR.changeRecord}`,
        `--reviewer=${OPERATOR.independentReviewer}`,
        `--reviewed-at=${OPERATOR.reviewedAt}`,
        `--output=${join(outDir, 'plan.json')}`,
      ],
      { io: sink, now: () => '2026-08-27T13:00:00.000Z' },
    )

    expect(code).toBe(0)
    expect(readdirSync(outDir)).toEqual(['plan.json'])
    const plan = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8')) as {
      reverseDdlPermitted: boolean
      steps: ReadonlyArray<{ phase: string }>
    }
    expect(plan.reverseDdlPermitted).toBe(false)
    expect(plan.steps.map(({ phase }) => phase)).toEqual([
      'plan',
      'authorize',
      'contain',
      'execute',
      'read-back',
      'emit',
    ])
    // The digest an operator must quote back is printed, and the command stops.
    expect(written.join('\n')).toContain('--authorization')
  })
})

describe('rehearse-recovery --apply', () => {
  it('exits 2 without an authorization', async () => {
    const space = applyWorkspace()
    const { io: sink, written } = io()
    const code = await runRehearseRecoveryCli(applyArgs(space, ['--authorization']), {
      io: sink,
    })
    expect(code).toBe(2)
    expect(written.join('\n')).toContain('--authorization')
    expect(readdirSync(space.outDir)).toEqual([])
  })

  it('exits 2 without --operator or --reason, before reading any input', async () => {
    for (const omitted of ['--operator', '--reason']) {
      const space = applyWorkspace()
      const { io: sink, written } = io()
      const code = await runRehearseRecoveryCli(applyArgs(space, [omitted]), { io: sink })
      expect(code, omitted).toBe(2)
      expect(written.join('\n')).toContain(omitted)
      expect(readdirSync(space.outDir)).toEqual([])
    }
  })

  it('exits 2 without an operator-supplied platform receipt', async () => {
    const space = applyWorkspace()
    const { io: sink, written } = io()
    const code = await runRehearseRecoveryCli(applyArgs(space, ['--platform-receipt']), {
      io: sink,
    })
    expect(code).toBe(2)
    expect(written.join('\n')).toContain('--platform-receipt')
    expect(readdirSync(space.outDir)).toEqual([])
  })

  it('refuses an authorization that does not cover the emitted plan digest', async () => {
    const space = applyWorkspace({ planSha256: 'f'.repeat(64) })
    const { io: sink, written } = io()
    const code = await runRehearseRecoveryCli(applyArgs(space), { io: sink })
    expect(code).not.toBe(0)
    expect(written.join('\n')).toContain('re-authorize')
    expect(readdirSync(space.outDir)).toEqual([])
  })

  it('emits evidence with every dependency retained beside it', async () => {
    const space = applyWorkspace()
    const { io: sink } = io()
    const code = await runRehearseRecoveryCli(applyArgs(space), { io: sink })
    expect(code).toBe(0)

    const parsed = parseRecoveryRehearsalEvidence(
      readFileSync(join(space.outDir, 'recovery-rehearsal.json'), 'utf8'),
    )
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n')).toBe(true)
    if (!parsed.ok) return
    expect(parsed.evidence.reverseDdlExecuted).toBe(false)
    expect(parsed.evidence.outcome).toBe('passed')

    const retained = new Set(
      readdirSync(space.outDir)
        .filter((name) => name.endsWith('.dependency'))
        .map((name) => name.replace('.dependency', '')),
    )
    for (const digest of recoveryRehearsalDependencyDigests(parsed.evidence)) {
      expect(retained.has(digest), `dependency ${digest} was not retained`).toBe(true)
      expect(
        releaseEvidenceSha256(readFileSync(join(space.outDir, `${digest}.dependency`))),
      ).toBe(digest)
    }
  })

  it('refuses to overwrite an existing evidence artifact', async () => {
    const space = applyWorkspace()
    expect(await runRehearseRecoveryCli(applyArgs(space), { io: io().io })).toBe(0)
    expect(await runRehearseRecoveryCli(applyArgs(space), { io: io().io })).not.toBe(0)
  })
})

describe('rehearse-recovery safety surface', () => {
  const source = readFileSync(resolve('scripts/release/rehearse-recovery.ts'), 'utf8')

  it('never spawns a process, so it can never issue a Railway restore', () => {
    for (const forbidden of [
      'child_process',
      'spawnSync',
      'execSync',
      'execFileSync',
      'railway ',
    ]) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })

  // The exclusive-create flag now lives in write-once.ts, so what this file has
  // to prove is that it never reaches around that helper to a raw write.
  it('creates every artifact only through the write-once helper', () => {
    expect(source).toContain("from '../../src/shared/release/write-once'")
    expect(source).not.toContain('writeFileSync')
  })
})
