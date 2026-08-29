import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRailwayContext } from 'railway/iac'
import { buildRailwayProject } from '../../.railway/railway'
import {
  CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
} from '../../.railway/service-source-map'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import { runRailwayDataCellFoundationCli } from './railway-data-cell-foundation'
import { railwaySavedPlanSourceTree } from './staged-railway-sources'

const TARGET = Object.freeze({
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  environmentId: '22222222-2222-4222-8222-222222222222',
  environmentName: 'cell-us',
})

const SOURCE_MANAGED_SERVICES = [
  'schema-migrator',
  'google-provider-redis',
  'web',
  'worker',
  'google-execution-admission',
  'google-egress-gateway',
  'ai-execution-admission',
  'ai-egress-gateway',
] as const
const DATABASE_SERVICES = ['Postgres', 'Cache Redis', 'Queue Redis'] as const
const temporaryDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryPlanPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'repkey-foundation-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'foundation.plan')
}

function stableJson(value: unknown): string {
  const sorted = (child: unknown): unknown => {
    if (Array.isArray(child)) return child.map(sorted)
    if (child !== null && typeof child === 'object') {
      return Object.fromEntries(
        Object.entries(child as Readonly<Record<string, unknown>>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, sorted(value)]),
      )
    }
    return child
  }
  return JSON.stringify(sorted(value))
}

function foundationResources(): Array<Record<string, unknown>> {
  const graph = buildRailwayProject(
    createRailwayContext({
      projectName: TARGET.projectName,
      environmentName: TARGET.environmentName,
    }),
    TARGET.environmentName,
    'production',
    RAILWAY_FOUNDATION_SOURCE_INPUT,
    TARGET.projectName,
  )
  return JSON.parse(JSON.stringify(graph.resources)) as Array<Record<string, unknown>>
}

function foundationChanges(): Array<Record<string, unknown>> {
  return foundationResources().map((resource) => {
    const address = String(resource.address)
    const type = String(resource.type)
    const name = String(resource.name)
    return {
      kind: 'resource.create',
      address,
      resource,
      path: `resources.${address}`,
      summary: `Create ${type} ${name}`,
      severity: 'safe',
      deployEffect: type === 'service' || type === 'database' ? 'deploy' : 'none',
    }
  })
}

function savedFoundationPlan(
  transform?: (plan: Record<string, unknown>) => void,
): string {
  const changes = foundationChanges()
  const changeSet = {
    version: 1,
    changes,
    diagnostics: [],
    declared: changes.map((change) => change.address),
    telemetry: { language: 'typescript' },
  }
  const plan: Record<string, unknown> = {
    kind: 'railway.config.plan',
    version: 1,
    cliVersion: '5.45.2',
    sourceTree: railwaySavedPlanSourceTree(),
    environmentId: TARGET.environmentId,
    configEtag: 'etag-foundation-empty',
    changeSetHash: `sha256:${createHash('sha256').update(stableJson(changeSet)).digest('hex')}`,
    changeSet,
    diff: changes.map((change) => `+ ${String(change.summary)}`).join('\n'),
    destructive: false,
  }
  transform?.(plan)
  if (transform) {
    const transformed = plan.changeSet as Record<string, unknown>
    plan.changeSetHash = `sha256:${createHash('sha256')
      .update(stableJson(transformed))
      .digest('hex')}`
  }
  return `${JSON.stringify(plan, null, 2)}\n`
}

function displayedFoundationPlan(): string {
  const changes = foundationChanges()
  return JSON.stringify({
    ok: true,
    command: 'plan',
    file: '.railway/railway.ts',
    currentEnvironment: {
      projectId: TARGET.projectId,
      projectName: TARGET.projectName,
      environmentId: TARGET.environmentId,
      environmentName: TARGET.environmentName,
      configEtag: 'etag-foundation-empty',
    },
    changeSet: {
      changes: changes.map((change) => ({
        summary: change.summary,
        severity: change.severity,
        kind: change.kind,
        details: null,
      })),
    },
    diff: changes.map((change) => `+ ${String(change.summary)}`).join('\n'),
    diagnostics: [],
    currentGraph: { project: { name: TARGET.projectName }, resources: [] },
    desiredGraph: {
      project: { name: TARGET.projectName },
      resources: foundationResources().map((resource) => ({
        address: resource.address,
        type: resource.type,
        name: resource.name,
        source: resource.source ?? null,
      })),
    },
    stagedPatch: null,
    applyResult: null,
    deploymentId: null,
    stagedPatchId: null,
  })
}

function runnerResource(resource: Record<string, unknown>): Record<string, unknown> {
  return {
    address: resource.address ?? null,
    type: resource.type,
    name: resource.name,
    engine: resource.engine ?? null,
    variables: resource.variables ?? null,
    source: resource.source ?? null,
    build: resource.build ?? null,
    deploy: resource.deploy ?? null,
    networking: resource.networking ?? null,
    volumeAttachments: resource.volumeAttachments ?? null,
    config: resource.config ?? null,
    groupId: resource.groupId ?? null,
  }
}

function noDriftFoundationPlan(
  transform?: (resources: Array<Record<string, unknown>>) => void,
): string {
  const resources = foundationResources().map(runnerResource)
  transform?.(resources)
  return JSON.stringify({
    ok: true,
    command: 'plan',
    file: '.railway/railway.ts',
    currentEnvironment: {
      projectId: TARGET.projectId,
      projectName: TARGET.projectName,
      environmentId: TARGET.environmentId,
      environmentName: TARGET.environmentName,
      configEtag: 'etag-foundation-applied',
    },
    changeSet: { changes: [] },
    diff: 'No changes.',
    diagnostics: [],
    currentGraph: {
      project: { name: TARGET.projectName },
      resources: foundationResources().map(runnerResource),
    },
    desiredGraph: { project: { name: TARGET.projectName }, resources },
    stagedPatch: null,
    applyResult: null,
    deploymentId: null,
    stagedPatchId: null,
  })
}

function projectStatus(sibling = false, existingService = false): string {
  return JSON.stringify({
    id: TARGET.projectId,
    name: TARGET.projectName,
    deletedAt: null,
    buckets: { edges: [] },
    services: {
      edges: existingService ? [{ node: { id: 'service-existing', name: 'web' } }] : [],
    },
    environments: {
      edges: [
        {
          node: {
            id: TARGET.environmentId,
            name: TARGET.environmentName,
            canAccess: true,
            deletedAt: null,
            unmergedChangesCount: 0,
            serviceInstances: {
              edges: existingService
                ? [
                    {
                      node: {
                        id: 'instance-existing',
                        serviceId: 'service-existing',
                        serviceName: 'web',
                        environmentId: TARGET.environmentId,
                        source: null,
                      },
                    },
                  ]
                : [],
            },
            volumeInstances: { edges: [] },
          },
        },
        ...(sibling
          ? [
              {
                node: {
                  id: '33333333-3333-4333-8333-333333333333',
                  name: 'production',
                  canAccess: true,
                  deletedAt: null,
                  unmergedChangesCount: 0,
                  serviceInstances: { edges: [] },
                  volumeInstances: { edges: [] },
                },
              },
            ]
          : []),
      ],
    },
  })
}

function foundationReadbackStatus(): string {
  const names = [...SOURCE_MANAGED_SERVICES, ...DATABASE_SERVICES]
  const services = names.map((name, index) => ({
    node: { id: `service-${String(index)}`, name },
  }))
  const instances = names.map((name, index) => ({
    node: {
      id: `instance-${String(index)}`,
      serviceId: `service-${String(index)}`,
      serviceName: name,
      environmentId: TARGET.environmentId,
      source: SOURCE_MANAGED_SERVICES.includes(
        name as (typeof SOURCE_MANAGED_SERVICES)[number],
      )
        ? null
        : { repo: null, image: `railway/${name.toLowerCase()}` },
    },
  }))
  const volumes = DATABASE_SERVICES.map((name, offset) => {
    const index = SOURCE_MANAGED_SERVICES.length + offset
    return {
      node: {
        id: `volume-instance-${String(index)}`,
        serviceId: `service-${String(index)}`,
        environmentId: TARGET.environmentId,
        deletedAt: null,
        isPendingDeletion: false,
        volume: { id: `volume-${String(index)}`, name: `${name} volume` },
      },
    }
  })
  return JSON.stringify({
    id: TARGET.projectId,
    name: TARGET.projectName,
    deletedAt: null,
    buckets: { edges: [{ node: { id: 'bucket-object-store', name: 'object-store' } }] },
    services: { edges: services },
    environments: {
      edges: [
        {
          node: {
            id: TARGET.environmentId,
            name: TARGET.environmentName,
            canAccess: true,
            deletedAt: null,
            unmergedChangesCount: 0,
            serviceInstances: { edges: instances },
            volumeInstances: { edges: volumes },
          },
        },
      ],
    },
  })
}

function successfulApplyOutput(): string {
  return JSON.stringify({
    status: 'complete',
    diagnostics: [],
    changes: foundationChanges().map((change) => ({
      kind: change.kind,
      path: change.path,
      status: 'applied',
    })),
  })
}

function args(mode: 'plan' | 'apply' | 'verify', planPath: string): string[] {
  return [
    mode,
    '--cell',
    'us',
    '--deployment-profile',
    'production',
    '--project-id',
    TARGET.projectId,
    '--environment-id',
    TARGET.environmentId,
    '--plan',
    planPath,
  ]
}

describe('single-US Railway foundation controller', () => {
  it('preflights the complete project and binds the exact 16-create plan', () => {
    const planPath = temporaryPlanPath()
    const saved = savedFoundationPlan()
    const calls: Array<Readonly<{ args: readonly string[]; env: NodeJS.ProcessEnv }>> = []
    const railway = (command: readonly string[], env: NodeJS.ProcessEnv) => {
      calls.push({ args: command, env })
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: projectStatus(), stderr: '' }
      }
      writeFileSync(planPath, saved, 'utf8')
      return { status: 2, stdout: displayedFoundationPlan(), stderr: '' }
    }
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    expect(runRailwayDataCellFoundationCli(args('plan', planPath), { railway })).toBe(0)
    expect(calls.map((call) => call.args)).toEqual([
      ['--version'],
      ['status', '--json'],
      [
        'config',
        'plan',
        '--file',
        '.railway/railway.ts',
        '--out',
        planPath,
        '--detailed-exit-code',
        '--json',
      ],
    ])
    expect(calls[1]?.env).toMatchObject({
      RAILWAY_PROJECT_ID: TARGET.projectId,
      RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
      REPKEY_RAILWAY_PROJECT_NAME: TARGET.projectName,
      REPKEY_RAILWAY_CELL_ENVIRONMENT: 'cell-us',
      REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
      [RAILWAY_SERVICE_SOURCE_MAP_ENV]: CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
    })
    expect(stderr.mock.calls.flat().join('')).toContain(
      createHash('sha256').update(saved).digest('hex'),
    )
  })

  it('refuses a sibling environment or non-empty project before planning', () => {
    for (const status of [projectStatus(true), projectStatus(false, true)]) {
      const planPath = temporaryPlanPath()
      const commands: string[] = []
      const railway = (command: readonly string[]) => {
        commands.push(command.join(' '))
        return command[0] === '--version'
          ? { status: 0, stdout: 'railway 5.45.2', stderr: '' }
          : { status: 0, stdout: status, stderr: '' }
      }
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      expect(runRailwayDataCellFoundationCli(args('plan', planPath), { railway })).toBe(1)
      expect(commands).toEqual(['--version', 'status --json'])
      vi.restoreAllMocks()
    }
  })

  it('rejects project-scoped credentials before invoking Railway', () => {
    vi.stubEnv('RAILWAY_TOKEN', 'project-token')
    const railway = vi.fn()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(args('plan', temporaryPlanPath()), { railway }),
    ).toBe(1)
    expect(railway).not.toHaveBeenCalled()
    expect(stderr.mock.calls.flat().join('')).toContain(
      'cannot prove the sole cell-us environment',
    )
  })

  it('pins foundation planning and apply to Railway CLI 5.45.2 exactly', () => {
    const railway = vi.fn(() => ({
      status: 0,
      stdout: 'railway 5.46.0',
      stderr: '',
    }))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(args('plan', temporaryPlanPath()), { railway }),
    ).toBe(1)
    expect(railway).toHaveBeenCalledTimes(1)
    expect(stderr.mock.calls.flat().join('')).toContain('pinned to CLI 5.45.2')
  })

  it('refuses a non-regular plan path before invoking Railway', () => {
    const planPath = temporaryPlanPath()
    execFileSync('mkfifo', [planPath])
    const railway = vi.fn()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // A FIFO opened non-blocking reads as EOF, so without the descriptor guard
    // the command would take an empty buffer for the reviewed artifact and
    // reject it as invalid JSON rather than refusing the path.
    expect(
      runRailwayDataCellFoundationCli(
        [...args('apply', planPath), '--plan-sha256', 'a'.repeat(64)],
        { railway },
      ),
    ).toBe(1)
    expect(railway).not.toHaveBeenCalled()
    expect(stderr.mock.calls.flat().join('')).toContain(
      'Railway Data Cell foundation refused: Railway foundation plan must be a regular file',
    )
  })

  it('refuses a symlinked plan path before invoking Railway', () => {
    const planPath = temporaryPlanPath()
    const reviewed = join(dirname(planPath), 'reviewed.plan')
    writeFileSync(reviewed, savedFoundationPlan(), 'utf8')
    symlinkSync(reviewed, planPath)
    const railway = vi.fn()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [
          ...args('apply', planPath),
          '--plan-sha256',
          createHash('sha256').update(readFileSync(reviewed)).digest('hex'),
        ],
        { railway },
      ),
    ).toBe(1)
    expect(railway).not.toHaveBeenCalled()
    expect(stderr.mock.calls.flat().join('')).toContain(
      'Railway Data Cell foundation refused: Railway foundation plan must be a regular file',
    )
  })

  it('refuses a digest-valid non-foundation saved plan before Railway', () => {
    const planPath = temporaryPlanPath()
    const invalid = savedFoundationPlan((plan) => {
      const changeSet = plan.changeSet as {
        changes: Array<Record<string, unknown>>
      }
      changeSet.changes[0] = {
        kind: 'resource.update',
        address: 'service.web',
        path: 'resources.service.web.source',
        summary: 'Update web source',
        severity: 'safe',
        deployEffect: 'deploy',
        before: null,
        after: { type: 'image', image: `ghcr.io/example/web@sha256:${'b'.repeat(64)}` },
      }
    })
    writeFileSync(planPath, invalid)
    const railway = vi.fn()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [
          ...args('apply', planPath),
          '--plan-sha256',
          createHash('sha256').update(invalid).digest('hex'),
        ],
        { railway },
      ),
    ).toBe(1)
    expect(railway).not.toHaveBeenCalled()
  })

  it('applies reviewed bytes, verifies every operation, then proves readback', () => {
    const planPath = temporaryPlanPath()
    const plan = savedFoundationPlan()
    writeFileSync(planPath, plan, 'utf8')
    const digest = createHash('sha256').update(plan).digest('hex')
    const commands: string[] = []
    let statusReads = 0
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        statusReads += 1
        return {
          status: 0,
          stdout: statusReads === 1 ? projectStatus() : foundationReadbackStatus(),
          stderr: '',
        }
      }
      if (command[0] === 'config' && command[1] === 'plan') {
        return { status: 0, stdout: noDriftFoundationPlan(), stderr: '' }
      }
      return { status: 0, stdout: successfulApplyOutput(), stderr: '' }
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [...args('apply', planPath), '--plan-sha256', digest],
        { railway },
      ),
    ).toBe(0)
    expect(commands).toEqual([
      '--version',
      'status --json',
      `config apply --plan ${planPath} --yes --json`,
      'status --json',
      'config plan --file .railway/railway.ts --detailed-exit-code --json',
    ])
  })

  it('does not accept a successful apply whose final graph has wrong placement', () => {
    const planPath = temporaryPlanPath()
    const plan = savedFoundationPlan()
    writeFileSync(planPath, plan, 'utf8')
    const digest = createHash('sha256').update(plan).digest('hex')
    let statusReads = 0
    const railway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        statusReads += 1
        return {
          status: 0,
          stdout: statusReads === 1 ? projectStatus() : foundationReadbackStatus(),
          stderr: '',
        }
      }
      if (command[0] === 'config' && command[1] === 'plan') {
        return {
          status: 0,
          stdout: noDriftFoundationPlan((resources) => {
            const web = resources.find((resource) => resource.address === 'service.web')
            if (web && web.deploy && typeof web.deploy === 'object') {
              web.deploy = { ...(web.deploy as object), region: 'us-east4' }
            }
          }),
          stderr: '',
        }
      }
      return { status: 0, stdout: successfulApplyOutput(), stderr: '' }
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [...args('apply', planPath), '--plan-sha256', digest],
        { railway },
      ),
    ).toBe(1)
  })

  it('recovers an ambiguous apply result through exact readback without reapplying', () => {
    const planPath = temporaryPlanPath()
    const plan = savedFoundationPlan()
    writeFileSync(planPath, plan, 'utf8')
    const digest = createHash('sha256').update(plan).digest('hex')
    const commands: string[] = []
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      return command[0] === 'status'
        ? { status: 0, stdout: foundationReadbackStatus(), stderr: '' }
        : { status: 0, stdout: noDriftFoundationPlan(), stderr: '' }
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [...args('verify', planPath), '--plan-sha256', digest],
        { railway },
      ),
    ).toBe(0)
    expect(commands).toEqual([
      '--version',
      'status --json',
      'config plan --file .railway/railway.ts --detailed-exit-code --json',
    ])
  })

  it('refuses recovery when no-drift output renders a wrong compute region', () => {
    const planPath = temporaryPlanPath()
    const plan = savedFoundationPlan()
    writeFileSync(planPath, plan, 'utf8')
    const digest = createHash('sha256').update(plan).digest('hex')
    const railway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationReadbackStatus(), stderr: '' }
      }
      return {
        status: 0,
        stdout: noDriftFoundationPlan((resources) => {
          const web = resources.find((resource) => resource.address === 'service.web')
          if (web && web.deploy && typeof web.deploy === 'object') {
            web.deploy = { ...(web.deploy as object), region: 'us-east4' }
          }
        }),
        stderr: '',
      }
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [...args('verify', planPath), '--plan-sha256', digest],
        { railway },
      ),
    ).toBe(1)
  })

  it('refuses partial apply success and never announces an unproved foundation', () => {
    const planPath = temporaryPlanPath()
    const plan = savedFoundationPlan()
    writeFileSync(planPath, plan, 'utf8')
    const digest = createHash('sha256').update(plan).digest('hex')
    const commands: string[] = []
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: projectStatus(), stderr: '' }
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          status: 'complete',
          diagnostics: [],
          changes: [
            { kind: 'resource.create', path: 'resources.service.web', status: 'applied' },
          ],
        }),
        stderr: '',
      }
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [...args('apply', planPath), '--plan-sha256', digest],
        { railway },
      ),
    ).toBe(1)
    expect(commands).toHaveLength(3)
  })

  it('detects plan tampering after the live apply preflight', () => {
    const planPath = temporaryPlanPath()
    const plan = savedFoundationPlan()
    writeFileSync(planPath, plan, 'utf8')
    const digest = createHash('sha256').update(plan).digest('hex')
    const commands: string[] = []
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      writeFileSync(planPath, `${plan} `, 'utf8')
      return { status: 0, stdout: projectStatus(), stderr: '' }
    }
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellFoundationCli(
        [...args('apply', planPath), '--plan-sha256', digest],
        { railway },
      ),
    ).toBe(1)
    expect(commands).toEqual(['--version', 'status --json'])
    expect(stderr.mock.calls.flat().join('')).toContain(
      'foundation plan changed after review',
    )
  })

  it.each(['europe', 'global'])(
    'refuses dormant future cell %s before invoking Railway',
    (cell) => {
      const railway = vi.fn()
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const invalidArgs = args('plan', temporaryPlanPath())
      invalidArgs[2] = cell

      expect(runRailwayDataCellFoundationCli(invalidArgs, { railway })).toBe(1)
      expect(railway).not.toHaveBeenCalled()
      expect(stderr.mock.calls.flat().join('')).toContain('--cell must be us')
    },
  )
})
