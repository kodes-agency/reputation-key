import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRailwayContext } from 'railway/iac'
import { buildRailwayProject } from '../../.railway/railway'
import { RAILWAY_FOUNDATION_SOURCE_INPUT } from '../../.railway/service-source-map'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import { runRailwayDataCellDomainCli } from './railway-data-cell-domain'

const TARGET = Object.freeze({
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  environmentId: '22222222-2222-4222-8222-222222222222',
  environmentName: 'cell-us',
})
const SOURCE_SERVICES = [
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

function temporaryIntentPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'repkey-domain-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'domain-intent.json')
}

function foundationStatus(sibling = false): string {
  const names = [...SOURCE_SERVICES, ...DATABASE_SERVICES]
  const services = names.map((name, index) => ({
    node: { id: `service-${String(index)}`, name },
  }))
  const instances = names.map((name, index) => ({
    node: {
      id: `instance-${String(index)}`,
      serviceId: `service-${String(index)}`,
      serviceName: name,
      environmentId: TARGET.environmentId,
      source: SOURCE_SERVICES.includes(name as (typeof SOURCE_SERVICES)[number])
        ? null
        : { repo: null, image: `railway/${name.toLowerCase()}` },
    },
  }))
  const volumes = DATABASE_SERVICES.map((name, offset) => {
    const index = SOURCE_SERVICES.length + offset
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
        ...(sibling
          ? [
              {
                node: {
                  id: 'environment-sibling',
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

function foundationNoDriftPlan(): string {
  const definition = buildRailwayProject(
    createRailwayContext({
      projectName: TARGET.projectName,
      environmentName: TARGET.environmentName,
    }),
    TARGET.environmentName,
    'production',
    RAILWAY_FOUNDATION_SOURCE_INPUT,
    TARGET.projectName,
  )
  const resources = (
    JSON.parse(JSON.stringify(definition.resources)) as Array<Record<string, unknown>>
  ).map(runnerResource)
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
    currentGraph: { project: { name: TARGET.projectName }, resources },
    desiredGraph: { project: { name: TARGET.projectName }, resources },
    stagedPatch: null,
    applyResult: null,
    deploymentId: null,
    stagedPatchId: null,
  })
}

function pulledDomainGraph(port = 8080): string {
  return JSON.stringify({
    project: { name: TARGET.projectName },
    resources: [
      {
        address: 'service.web',
        type: 'service',
        name: 'web',
        networking: {
          customDomains: { 'us.reputationkey.app': { port } },
        },
      },
    ],
  })
}

function args(
  mode: 'plan' | 'apply' | 'recover' | 'verify',
  intentPath: string,
): string[] {
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
    '--intent',
    intentPath,
  ]
}

function domainListCommand(serviceId: string): string {
  return `domain list --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service ${serviceId} --json`
}

function requestedServiceId(command: readonly string[]): string | undefined {
  const index = command.indexOf('--service')
  return index < 0 ? undefined : command[index + 1]
}

const emptyDomains = JSON.stringify({ domains: [] })
const probeOrigin = 'https://repkey-us-probe.up.railway.app'
const createdProbeDomain = JSON.stringify({ domain: probeOrigin })
const probeDomains = JSON.stringify({
  domains: [
    {
      id: 'domain-us-probe',
      domain: 'repkey-us-probe.up.railway.app',
      type: 'service',
      targetPort: 8080,
      syncStatus: 'ACTIVE',
    },
  ],
})
const createdDomain = JSON.stringify({
  customDomainCreate: {
    id: 'domain-us-production',
    domain: 'us.reputationkey.app',
    projectId: TARGET.projectId,
    environmentId: TARGET.environmentId,
    serviceId: 'service-2',
    targetPort: 8080,
    syncStatus: 'CREATING',
  },
})
const registeredDomains = JSON.stringify({
  domains: [
    {
      id: 'domain-us-probe',
      domain: 'repkey-us-probe.up.railway.app',
      type: 'service',
      targetPort: 8080,
      syncStatus: 'ACTIVE',
    },
    {
      id: 'domain-us-production',
      domain: 'us.reputationkey.app',
      type: 'custom',
      targetPort: 8080,
      syncStatus: 'CREATING',
    },
  ],
})
const activeRegisteredDomains = JSON.stringify({
  domains: (
    JSON.parse(registeredDomains) as { domains: Array<Record<string, unknown>> }
  ).domains.map((domain) => ({ ...domain, syncStatus: 'ACTIVE' })),
})
const pendingDomainStatus = JSON.stringify({
  domain: {
    id: 'domain-us-production',
    domain: 'us.reputationkey.app',
    type: 'custom',
    targetPort: 8080,
    syncStatus: 'CREATING',
    dnsRecords: [
      {
        recordType: 'CNAME',
        fqdn: 'us.reputationkey.app',
        requiredValue: 'repkey-us-probe.up.railway.app',
      },
    ],
  },
})
const verifiedDomainStatus = JSON.stringify({
  domain: {
    id: 'domain-us-production',
    domain: 'us.reputationkey.app',
    type: 'custom',
    targetPort: 8080,
    syncStatus: 'ACTIVE',
    dnsRecords: [
      {
        recordType: 'CNAME',
        fqdn: 'us.reputationkey.app',
        requiredValue: 'repkey-us-probe.up.railway.app',
      },
    ],
    verification: { verified: true },
    certificate: { status: 'CERTIFICATE_STATUS_TYPE_VALID' },
    certificates: [
      {
        domainNames: ['us.reputationkey.app'],
        fingerprintSha256: 'certificate-fingerprint',
      },
    ],
  },
})

describe('single-US Railway production domain ceremony', () => {
  it('writes a private exact-target intent after read-only foundation proof', () => {
    const intentPath = temporaryIntentPath()
    const commands: string[] = []
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      return { status: 0, stdout: emptyDomains, stderr: '' }
    }
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(runRailwayDataCellDomainCli(args('plan', intentPath), { railway })).toBe(0)
    expect(commands).toEqual([
      '--version',
      'status --json',
      'config plan --file .railway/railway.ts --detailed-exit-code --json',
      ...SOURCE_SERVICES.map((_, index) => domainListCommand(`service-${String(index)}`)),
    ])
    const bytes = readFileSync(intentPath)
    expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({
      project: { id: TARGET.projectId, name: TARGET.projectName },
      environment: { id: TARGET.environmentId, name: 'cell-us' },
      service: { id: 'service-2', instanceId: 'instance-2', name: 'web' },
      probeDomain: { type: 'railway-service', targetPort: 8080 },
      domain: 'us.reputationkey.app',
      targetPort: 8080,
    })
    expect(stdout.mock.calls.flat().join('')).toBe(bytes.toString('utf8'))
    expect(stderr.mock.calls.flat().join('')).toContain(
      createHash('sha256').update(bytes).digest('hex'),
    )
  })

  it('refuses a second plan into the same path and retains the first private intent', () => {
    const intentPath = temporaryIntentPath()
    const railway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      return { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(runRailwayDataCellDomainCli(args('plan', intentPath), { railway })).toBe(0)
    const retained = readFileSync(intentPath)

    expect(runRailwayDataCellDomainCli(args('plan', intentPath), { railway })).toBe(1)
    expect(stderr.mock.calls.flat().join('')).toContain(
      'Railway Data Cell domain refused: Railway domain intent path already exists',
    )
    expect(readFileSync(intentPath)).toEqual(retained)
    expect(statSync(intentPath).mode & 0o777).toBe(0o600)
  })

  it('applies only reviewed bytes and verifies exact domain readback', () => {
    const intentPath = temporaryIntentPath()
    const planningRailway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      return command[0] === 'config'
        ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
        : { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(
      runRailwayDataCellDomainCli(args('plan', intentPath), {
        railway: planningRailway,
      }),
    ).toBe(0)
    vi.restoreAllMocks()

    const bytes = readFileSync(intentPath)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const commands: string[] = []
    let domainReads = 0
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      if (command[1] === 'list') {
        if (requestedServiceId(command) !== 'service-2') {
          return { status: 0, stdout: emptyDomains, stderr: '' }
        }
        domainReads += 1
        return {
          status: 0,
          stdout:
            domainReads === 1
              ? emptyDomains
              : domainReads === 2
                ? probeDomains
                : registeredDomains,
          stderr: '',
        }
      }
      if (command[0] === 'domain' && command[1] === '--port') {
        return { status: 0, stdout: createdProbeDomain, stderr: '' }
      }
      if (command[0] === 'domain' && command[1] === 'status') {
        return { status: 0, stdout: pendingDomainStatus, stderr: '' }
      }
      return { status: 0, stdout: createdDomain, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellDomainCli(
        [...args('apply', intentPath), '--intent-sha256', digest],
        { railway },
      ),
    ).toBe(0)
    expect(commands).toEqual([
      '--version',
      'status --json',
      'config plan --file .railway/railway.ts --detailed-exit-code --json',
      ...SOURCE_SERVICES.map((_, index) => domainListCommand(`service-${String(index)}`)),
      `domain --port 8080 --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service service-2 --json`,
      `domain list --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service service-2 --json`,
      `domain us.reputationkey.app --port 8080 --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service service-2 --json`,
      `domain list --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service service-2 --json`,
      `domain status us.reputationkey.app --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service service-2 --json`,
    ])
  })

  it('recovers the reviewed probe-only partial state without creating another probe', () => {
    const intentPath = temporaryIntentPath()
    const planningRailway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      return command[0] === 'config'
        ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
        : { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(
      runRailwayDataCellDomainCli(args('plan', intentPath), {
        railway: planningRailway,
      }),
    ).toBe(0)
    vi.restoreAllMocks()

    const digest = createHash('sha256').update(readFileSync(intentPath)).digest('hex')
    const commands: string[] = []
    let domainReads = 0
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      if (command[1] === 'list') {
        if (requestedServiceId(command) !== 'service-2') {
          return { status: 0, stdout: emptyDomains, stderr: '' }
        }
        domainReads += 1
        return {
          status: 0,
          stdout: domainReads === 1 ? probeDomains : registeredDomains,
          stderr: '',
        }
      }
      if (command[0] === 'domain' && command[1] === 'status') {
        return { status: 0, stdout: pendingDomainStatus, stderr: '' }
      }
      return { status: 0, stdout: createdDomain, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellDomainCli(
        [...args('recover', intentPath), '--intent-sha256', digest],
        { railway },
      ),
    ).toBe(0)
    expect(commands.some((command) => command.startsWith('domain --port'))).toBe(false)
    expect(commands.some((command) => command.startsWith('domain us.'))).toBe(true)
  })

  it('recovers an ambiguous final readback without repeating either create', () => {
    const intentPath = temporaryIntentPath()
    const planningRailway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      return command[0] === 'config'
        ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
        : { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(
      runRailwayDataCellDomainCli(args('plan', intentPath), {
        railway: planningRailway,
      }),
    ).toBe(0)
    vi.restoreAllMocks()

    const digest = createHash('sha256').update(readFileSync(intentPath)).digest('hex')
    const commands: string[] = []
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      if (command[1] === 'list') {
        return {
          status: 0,
          stdout:
            requestedServiceId(command) === 'service-2'
              ? registeredDomains
              : emptyDomains,
          stderr: '',
        }
      }
      return { status: 0, stdout: pendingDomainStatus, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellDomainCli(
        [...args('recover', intentPath), '--intent-sha256', digest],
        { railway },
      ),
    ).toBe(0)
    expect(
      commands.filter(
        (command) =>
          command.startsWith('domain ') &&
          (command.includes('--service service-2 ') ||
            command.startsWith('domain status')),
      ),
    ).toEqual([
      domainListCommand('service-2'),
      `domain status us.reputationkey.app --project ${TARGET.projectId} --environment ${TARGET.environmentId} --service service-2 --json`,
    ])
  })

  it('verifies ACTIVE domain sync, DNS ownership, and a valid certificate', () => {
    const intentPath = temporaryIntentPath()
    const planningRailway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      return command[0] === 'config'
        ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
        : { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(
      runRailwayDataCellDomainCli(args('plan', intentPath), {
        railway: planningRailway,
      }),
    ).toBe(0)
    vi.restoreAllMocks()

    const digest = createHash('sha256').update(readFileSync(intentPath)).digest('hex')
    const commands: string[] = []
    const railway = (command: readonly string[]) => {
      commands.push(command.join(' '))
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config' && command[1] === 'plan') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      if (command[0] === 'config' && command[1] === 'pull') {
        return { status: 0, stdout: pulledDomainGraph(), stderr: '' }
      }
      if (command[1] === 'list') {
        return {
          status: 0,
          stdout:
            requestedServiceId(command) === 'service-2'
              ? activeRegisteredDomains
              : emptyDomains,
          stderr: '',
        }
      }
      return { status: 0, stdout: verifiedDomainStatus, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellDomainCli(
        [...args('verify', intentPath), '--intent-sha256', digest],
        { railway },
      ),
    ).toBe(0)
    expect(commands.at(-1)).toBe('config pull --json')
  })

  it('refuses verify when Railway current configuration retains the wrong port', () => {
    const intentPath = temporaryIntentPath()
    const planningRailway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      return command[0] === 'config'
        ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
        : { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(
      runRailwayDataCellDomainCli(args('plan', intentPath), {
        railway: planningRailway,
      }),
    ).toBe(0)
    vi.restoreAllMocks()

    const digest = createHash('sha256').update(readFileSync(intentPath)).digest('hex')
    const railway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config' && command[1] === 'plan') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      if (command[0] === 'config' && command[1] === 'pull') {
        return { status: 0, stdout: pulledDomainGraph(3000), stderr: '' }
      }
      if (command[1] === 'list') {
        return {
          status: 0,
          stdout:
            requestedServiceId(command) === 'service-2'
              ? activeRegisteredDomains
              : emptyDomains,
          stderr: '',
        }
      }
      return { status: 0, stdout: verifiedDomainStatus, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellDomainCli(
        [...args('verify', intentPath), '--intent-sha256', digest],
        { railway },
      ),
    ).toBe(1)
  })

  it('refuses unsafe domain deletion state during recovery', () => {
    const intentPath = temporaryIntentPath()
    const planningRailway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      return command[0] === 'config'
        ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
        : { status: 0, stdout: emptyDomains, stderr: '' }
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(
      runRailwayDataCellDomainCli(args('plan', intentPath), {
        railway: planningRailway,
      }),
    ).toBe(0)
    vi.restoreAllMocks()

    const digest = createHash('sha256').update(readFileSync(intentPath)).digest('hex')
    const railway = (command: readonly string[]) => {
      if (command[0] === '--version') {
        return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
      }
      if (command[0] === 'status') {
        return { status: 0, stdout: foundationStatus(), stderr: '' }
      }
      if (command[0] === 'config') {
        return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
      }
      if (command[1] === 'list' && requestedServiceId(command) !== 'service-2') {
        return { status: 0, stdout: emptyDomains, stderr: '' }
      }
      return {
        status: 0,
        stdout: probeDomains.replace('ACTIVE', 'DELETING'),
        stderr: '',
      }
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(
      runRailwayDataCellDomainCli(
        [...args('recover', intentPath), '--intent-sha256', digest],
        { railway },
      ),
    ).toBe(1)
  })

  it('refuses any existing domain or sibling environment before registration', () => {
    for (const scenario of [
      { status: foundationStatus(), domains: registeredDomains },
      { status: foundationStatus(true), domains: emptyDomains },
    ]) {
      const commands: string[] = []
      const railway = (command: readonly string[]) => {
        commands.push(command.join(' '))
        if (command[0] === '--version') {
          return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
        }
        if (command[0] === 'status') {
          return { status: 0, stdout: scenario.status, stderr: '' }
        }
        return command[0] === 'config'
          ? { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
          : { status: 0, stdout: scenario.domains, stderr: '' }
      }
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      expect(
        runRailwayDataCellDomainCli(args('plan', temporaryIntentPath()), { railway }),
      ).toBe(1)
      expect(commands.some((command) => command.startsWith('domain us.'))).toBe(false)
      vi.restoreAllMocks()
    }
  })

  it('rejects rehearsal, future cells, and project-scoped credentials locally', () => {
    const railway = vi.fn()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const rehearsal = args('plan', temporaryIntentPath())
    rehearsal[4] = 'rehearsal'
    expect(runRailwayDataCellDomainCli(rehearsal, { railway })).toBe(1)

    const future = args('plan', temporaryIntentPath())
    future[2] = 'europe'
    expect(runRailwayDataCellDomainCli(future, { railway })).toBe(1)

    vi.stubEnv('RAILWAY_TOKEN', 'project-token')
    expect(
      runRailwayDataCellDomainCli(args('plan', temporaryIntentPath()), { railway }),
    ).toBe(1)
    expect(railway).not.toHaveBeenCalled()
  })
})
