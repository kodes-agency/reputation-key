import { describe, expect, it } from 'vitest'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import {
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayFoundationReadback,
  assertSingleUsBetaRailwayFoundationIsolation,
  assertSingleUsBetaRailwayProjectIsolation,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from './railway-project-service-isolation'

const EXPECTED_SERVICE_NAMES = [
  'schema-migrator',
  'google-provider-redis',
  'web',
  'worker',
  'google-execution-admission',
  'google-egress-gateway',
  'ai-execution-admission',
  'ai-egress-gateway',
] as const

const DATABASE_SERVICE_NAMES = ['Postgres', 'Cache Redis', 'Queue Redis'] as const

const TARGET = {
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  environmentId: '22222222-2222-4222-8222-222222222222',
  environmentName: 'cell-us',
} as const

function serviceId(index: number): string {
  return `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

function instanceId(index: number): string {
  return `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

function readbackFixture(): Record<string, unknown> {
  const services = EXPECTED_SERVICE_NAMES.map((name, index) => ({
    node: { id: serviceId(index), name },
  }))
  const targetInstances = EXPECTED_SERVICE_NAMES.map((name, index) => ({
    node: {
      id: instanceId(index),
      serviceId: serviceId(index),
      serviceName: name,
      environmentId: TARGET.environmentId,
      source: null,
    },
  }))
  return {
    id: TARGET.projectId,
    name: TARGET.projectName,
    deletedAt: null,
    buckets: { edges: [] },
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
            serviceInstances: { edges: targetInstances },
            volumeInstances: { edges: [] },
          },
        },
      ],
    },
  }
}

function addSiblingEnvironment(
  fixture: Record<string, unknown>,
  serviceInstances: readonly unknown[] = [],
  canAccess = true,
): void {
  const environments = fixture.environments as {
    edges: Array<{ node: Record<string, unknown> }>
  }
  environments.edges.push({
    node: {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'second-environment',
      canAccess,
      deletedAt: null,
      unmergedChangesCount: 0,
      serviceInstances: { edges: [...serviceInstances] },
      volumeInstances: { edges: [] },
    },
  })
}

function assertFixture(fixture: Record<string, unknown>) {
  return assertSingleUsBetaRailwayProjectIsolation(
    parseRailwayProjectServiceInventory(JSON.stringify(fixture)),
    TARGET,
  )
}

function blankFoundationFixture(): Record<string, unknown> {
  const fixture = readbackFixture()
  fixture.services = { edges: [] }
  const environments = fixture.environments as {
    edges: Array<{
      node: {
        serviceInstances: { edges: unknown[] }
        volumeInstances: { edges: unknown[] }
      }
    }>
  }
  environments.edges[0]!.node.serviceInstances.edges = []
  environments.edges[0]!.node.volumeInstances.edges = []
  return fixture
}

function foundationReadbackFixture(): Record<string, unknown> {
  const fixture = readbackFixture()
  const services = fixture.services as { edges: unknown[] }
  const environments = fixture.environments as {
    edges: Array<{
      node: {
        serviceInstances: { edges: unknown[] }
        volumeInstances: { edges: unknown[] }
      }
    }>
  }
  const instances = environments.edges[0]!.node.serviceInstances.edges
  for (const [offset, name] of DATABASE_SERVICE_NAMES.entries()) {
    const index = EXPECTED_SERVICE_NAMES.length + offset
    services.edges.push({ node: { id: serviceId(index), name } })
    instances.push({
      node: {
        id: instanceId(index),
        serviceId: serviceId(index),
        serviceName: name,
        environmentId: TARGET.environmentId,
        source: { repo: null, image: `railway/${name.toLowerCase()}` },
      },
    })
    environments.edges[0]!.node.volumeInstances.edges.push({
      node: {
        id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        serviceId: serviceId(index),
        environmentId: TARGET.environmentId,
        deletedAt: null,
        isPendingDeletion: false,
        volume: {
          id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          name: `${name} volume`,
        },
      },
    })
  }
  fixture.buckets = {
    edges: [
      { node: { id: '70000000-0000-4000-8000-000000000001', name: 'object-store' } },
    ],
  }
  return fixture
}

describe('single-US Railway project service isolation', () => {
  it('rejects environment-scoped project credentials for a full-project proof', () => {
    expect(() =>
      assertRailwayFullProjectVisibilityCredential({ RAILWAY_TOKEN: 'project-token' }),
    ).toThrow('cannot prove the sole cell-us environment')
    expect(() =>
      assertRailwayFullProjectVisibilityCredential({
        RAILWAY_API_TOKEN: 'workspace-token',
      }),
    ).not.toThrow()
  })

  it('uses only the unscoped full-project JSON readback command', () => {
    expect(railwayFullProjectStatusArgs()).toEqual(['status', '--json'])
  })

  it('returns all eight exact service and target-instance IDs', () => {
    expect(assertFixture(readbackFixture())).toEqual({
      target: TARGET,
      services: Object.fromEntries(
        EXPECTED_SERVICE_NAMES.map((name, index) => [
          name,
          {
            serviceId: serviceId(index),
            serviceInstanceId: instanceId(index),
          },
        ]),
      ),
    })
  })

  it('proves the exact sole target before foundation services exist', () => {
    const fixture = blankFoundationFixture()

    expect(
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(fixture)),
        TARGET,
      ),
    ).toEqual(TARGET)
  })

  it('refuses a sibling environment during source-less foundation preflight', () => {
    const fixture = blankFoundationFixture()
    addSiblingEnvironment(fixture)

    expect(() =>
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(fixture)),
        TARGET,
      ),
    ).toThrow(
      'dedicated Railway beta project must contain exactly one environment; observed 2',
    )
  })

  it('refuses any pre-existing service or service instance during foundation', () => {
    const withService = readbackFixture()
    expect(() =>
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(withService)),
        TARGET,
      ),
    ).toThrow('Railway foundation requires a fresh project with zero services')

    const withOrphanInstance = readbackFixture()
    withOrphanInstance.services = { edges: [] }
    expect(() =>
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(withOrphanInstance)),
        TARGET,
      ),
    ).toThrow('Railway foundation requires zero service instances')
  })

  it('refuses buckets, volumes, and staged changes during foundation', () => {
    const withBucket = blankFoundationFixture()
    withBucket.buckets = {
      edges: [{ node: { id: 'bucket-existing', name: 'existing' } }],
    }
    expect(() =>
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(withBucket)),
        TARGET,
      ),
    ).toThrow('Railway foundation requires zero buckets')

    const withVolume = blankFoundationFixture()
    const volumeEnvironment = withVolume.environments as {
      edges: Array<{ node: { volumeInstances: { edges: unknown[] } } }>
    }
    volumeEnvironment.edges[0]!.node.volumeInstances.edges.push({
      node: {
        id: 'volume-instance-existing',
        serviceId: 'service-existing',
        environmentId: TARGET.environmentId,
        deletedAt: null,
        isPendingDeletion: false,
        volume: { id: 'volume-existing', name: 'existing' },
      },
    })
    expect(() =>
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(withVolume)),
        TARGET,
      ),
    ).toThrow('Railway foundation requires zero volume instances')

    const withStagedChange = blankFoundationFixture()
    const stagedEnvironment = withStagedChange.environments as {
      edges: Array<{ node: { unmergedChangesCount: number } }>
    }
    stagedEnvironment.edges[0]!.node.unmergedChangesCount = 1
    expect(() =>
      assertSingleUsBetaRailwayFoundationIsolation(
        parseRailwayProjectServiceInventory(JSON.stringify(withStagedChange)),
        TARGET,
      ),
    ).toThrow('Railway environment has unmerged changes')
  })

  it('proves the complete source-less foundation readback', () => {
    expect(
      assertSingleUsBetaRailwayFoundationReadback(
        parseRailwayProjectServiceInventory(JSON.stringify(foundationReadbackFixture())),
        TARGET,
      ),
    ).toMatchObject({ target: TARGET })
  })

  it('refuses a runnable source or incomplete database storage after foundation', () => {
    const withSource = foundationReadbackFixture()
    const sourceEnvironment = withSource.environments as {
      edges: Array<{
        node: { serviceInstances: { edges: Array<{ node: Record<string, unknown> }> } }
      }>
    }
    sourceEnvironment.edges[0]!.node.serviceInstances.edges[0]!.node.source = {
      repo: null,
      image: 'ghcr.io/example/web@sha256:aaaaaaaa',
    }
    expect(() =>
      assertSingleUsBetaRailwayFoundationReadback(
        parseRailwayProjectServiceInventory(JSON.stringify(withSource)),
        TARGET,
      ),
    ).toThrow('runnable source on schema-migrator')

    const missingVolume = foundationReadbackFixture()
    const volumeEnvironment = missingVolume.environments as {
      edges: Array<{ node: { volumeInstances: { edges: unknown[] } } }>
    }
    volumeEnvironment.edges[0]!.node.volumeInstances.edges.pop()
    expect(() =>
      assertSingleUsBetaRailwayFoundationReadback(
        parseRailwayProjectServiceInventory(JSON.stringify(missingVolume)),
        TARGET,
      ),
    ).toThrow('volume instances; expected 3')
  })

  it('refuses any sibling environment before inspecting its service instances', () => {
    const fixture = readbackFixture()
    addSiblingEnvironment(fixture, [
      {
        node: {
          id: '66666666-6666-4666-8666-666666666666',
          serviceId: serviceId(2),
          serviceName: 'web',
          environmentId: '55555555-5555-4555-8555-555555555555',
          source: null,
        },
      },
    ])

    expect(() => assertFixture(fixture)).toThrow(
      'dedicated Railway beta project must contain exactly one environment; observed 2',
    )
  })

  it('refuses a service ID with multiple instances in cell-us', () => {
    const fixture = readbackFixture()
    const environments = fixture.environments as {
      edges: Array<{ node: { serviceInstances: { edges: unknown[] } } }>
    }
    environments.edges[0]?.node.serviceInstances.edges.push({
      node: {
        id: '66666666-6666-4666-8666-666666666666',
        serviceId: serviceId(0),
        serviceName: EXPECTED_SERVICE_NAMES[0],
        environmentId: TARGET.environmentId,
        source: null,
      },
    })

    expect(() => assertFixture(fixture)).toThrow(
      'schema-migrator service ID has 2 instances; expected exactly 1',
    )
  })

  it('refuses incomplete project visibility instead of treating it as absence', () => {
    const fixture = readbackFixture()
    addSiblingEnvironment(fixture, [], false)

    expect(() => assertFixture(fixture)).toThrow(
      'cannot prove service isolation while a Railway environment is inaccessible',
    )
  })

  it('refuses wrong project/target identity and missing service instances', () => {
    const wrongProject = readbackFixture()
    wrongProject.id = '77777777-7777-4777-8777-777777777777'
    expect(() => assertFixture(wrongProject)).toThrow(
      'Railway project ID does not match the reviewed target',
    )

    const missingWorker = readbackFixture()
    const environments = missingWorker.environments as {
      edges: Array<{ node: { serviceInstances: { edges: unknown[] } } }>
    }
    environments.edges[0]?.node.serviceInstances.edges.splice(3, 1)
    expect(() => assertFixture(missingWorker)).toThrow(
      'worker service ID has 0 instances; expected exactly 1',
    )
  })

  it('refuses duplicate expected service names and malformed JSON', () => {
    const duplicate = readbackFixture()
    const services = duplicate.services as { edges: unknown[] }
    services.edges.push({
      node: {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'web',
      },
    })
    expect(() => assertFixture(duplicate)).toThrow(
      'Railway project has 2 services named web; expected exactly 1',
    )
    expect(() => parseRailwayProjectServiceInventory('{')).toThrow(
      'Railway project status is not valid JSON',
    )
  })
})
