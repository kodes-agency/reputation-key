import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRailwayContext } from 'railway/iac'
import { buildRailwayProject } from '../../.railway/railway'
import { RAILWAY_FOUNDATION_SOURCE_INPUT } from '../../.railway/service-source-map'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  GOOGLE_CONTENT_CAPABILITIES,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRole,
  type GoogleContentApprovalRoleDocument,
  type GoogleContentCapability,
} from '../../src/shared/auth/google-content-contract'
import {
  canonicalGoogleContentSha256,
  googleContentRoleSignaturePayload,
  type GoogleContentApprovalBundle,
  type GoogleContentApprovalCandidate,
  type GoogleContentRolePublicKeys,
} from '../../src/shared/auth/google-content-approval'
import type { GoogleContentRuntimeBinding } from '../../src/shared/auth/google-content-authority'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import {
  runRailwayGoogleContentApprovalActivationCli,
  type GoogleContentApprovalActivationDatabase,
  type RailwayGoogleContentApprovalActivationExecutor,
} from './railway-google-content-approval-activation'

const TARGET = Object.freeze({
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  environmentId: '22222222-2222-4222-8222-222222222222',
  environmentName: 'cell-us',
})
const NOW = new Date('2026-08-27T10:00:00.000Z')
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

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'repkey-google-activation-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function roleKeys(): Readonly<{
  publicKeys: GoogleContentRolePublicKeys
  privateKeys: Readonly<Record<GoogleContentApprovalRole, string>>
}> {
  const entries = GOOGLE_CONTENT_APPROVAL_ROLES.map((role) => {
    const pair = generateKeyPairSync('ed25519')
    return [
      role,
      {
        publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
    ] as const
  })
  return {
    publicKeys: Object.fromEntries(
      entries.map(([role, value]) => [role, value.publicKey]),
    ) as GoogleContentRolePublicKeys,
    privateKeys: Object.fromEntries(
      entries.map(([role, value]) => [role, value.privateKey]),
    ) as Readonly<Record<GoogleContentApprovalRole, string>>,
  }
}

function approvalBundle(
  capability: GoogleContentCapability,
  privateKeys: Readonly<Record<GoogleContentApprovalRole, string>>,
): GoogleContentApprovalBundle {
  const manifest = { capability, evidence: 'reviewed-google-content-beta-evidence' }
  const evidenceManifestSha256 = canonicalGoogleContentSha256(manifest)
  const cohort = ['organization-beta-1']
  const cohortSha256 = canonicalGoogleContentSha256(cohort)
  const residualRiskSha256 = canonicalGoogleContentSha256(
    'railway-closed-beta-residual-risk',
  )
  const approvedAt = NOW.toISOString()
  const expiresAt = '2026-09-24T10:00:00.000Z'
  const bindingBase: Omit<GoogleContentApprovalBinding, 'evidenceIndexSha256'> = {
    capability,
    targetPhase: 'railway_closed_beta',
    environmentProfile: 'railway-closed-beta-1',
    releaseSha: 'release-reviewed-sha',
    evidenceManifestSha256,
    deploymentAttestationSha256: canonicalGoogleContentSha256('deployment'),
    adr0050Sha256: canonicalGoogleContentSha256('adr-0050'),
    googleContentPolicyVersion: 'google-content-live-1',
    googleOAuthContractVersion: 'google-oauth-oidc-1',
    googleProjectAttestationSha256: canonicalGoogleContentSha256('project-attestation'),
    googleOAuthClientIdSha256: canonicalGoogleContentSha256('oauth-client-id'),
    googleRedirectUriSha256: canonicalGoogleContentSha256('redirect-uri'),
    providerOriginProfileSha256: canonicalGoogleContentSha256('provider-origin-profile'),
    runtimeIsolationProfileVersion: null,
    runtimeIsolationProfileSha256: null,
    railwayClosedBetaCohort: cohort,
    railwayClosedBetaCohortSha256: cohortSha256,
    railwayClosedBetaResidualRiskSha256: residualRiskSha256,
    performanceCatalogVersion: '2026-08-05',
    routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    capabilityPolicyVersion: 'beta-local-2',
    executionPolicyVersion: 'beta-local-2',
    migrationHead: '0140_single-us-beta',
    imageDigests: {
      web: `sha256:${canonicalGoogleContentSha256('web-image')}`,
      worker: `sha256:${canonicalGoogleContentSha256('worker-image')}`,
      googleExecutionAdmission: `sha256:${canonicalGoogleContentSha256('admission-image')}`,
      googleEgressGateway: `sha256:${canonicalGoogleContentSha256('gateway-image')}`,
      providerEphemeralRedis: `sha256:${canonicalGoogleContentSha256('redis-image')}`,
    },
    approvedAt,
    expiresAt,
    status: 'approved',
  }
  const roleDocuments = GOOGLE_CONTENT_APPROVAL_ROLES.map((role) => {
    const unsigned = {
      role,
      capability,
      manifestSha256: evidenceManifestSha256,
      releaseSha: bindingBase.releaseSha,
      targetPhase: bindingBase.targetPhase,
      environmentProfile: bindingBase.environmentProfile,
      transientPerformanceReportingDecision: 'approved',
      confirmedImportProfileTreatmentDecision: 'approved',
      unmanagedUserAgentMemoryResidualDecision: 'approved',
      railwayClosedBetaResidualDecision: 'approved',
      railwayClosedBetaCohortSha256: cohortSha256,
      railwayClosedBetaResidualRiskSha256: residualRiskSha256,
      approverIdentity: 'Closed Beta Owner <owner@example.test>',
      approvedAt,
      expiresAt,
    } as const
    const unsignedDocument = {
      ...unsigned,
      signature: '',
    } as GoogleContentApprovalRoleDocument
    const document = {
      ...unsigned,
      signature: sign(
        null,
        googleContentRoleSignaturePayload(unsignedDocument),
        privateKeys[role],
      ).toString('base64'),
    } as GoogleContentApprovalRoleDocument
    return { sha256: canonicalGoogleContentSha256(document), document }
  })
  const indexDocument = {
    manifestSha256: evidenceManifestSha256,
    artifactSha256: { deployment: bindingBase.deploymentAttestationSha256 },
    roleDocumentSha256: Object.fromEntries(
      roleDocuments.map(({ sha256, document }) => [document.role, sha256]),
    ) as GoogleContentApprovalCandidate['index']['roleDocumentSha256'],
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    manifest,
    candidate: {
      binding: { ...bindingBase, evidenceIndexSha256: index.sha256 },
      index,
      roleDocuments,
    },
  }
}

function runtimeBinding(
  bundle: GoogleContentApprovalBundle,
): GoogleContentRuntimeBinding {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = bundle.candidate.binding
  return runtime
}

function foundationStatus(): string {
  const names = [...SOURCE_SERVICES, ...DATABASE_SERVICES]
  return JSON.stringify({
    id: TARGET.projectId,
    name: TARGET.projectName,
    deletedAt: null,
    buckets: {
      edges: [{ node: { id: 'bucket-object-store', name: 'object-store' } }],
    },
    services: {
      edges: names.map((name, index) => ({
        node: { id: `service-${String(index)}`, name },
      })),
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
              edges: names.map((name, index) => ({
                node: {
                  id: `instance-${String(index)}`,
                  serviceId: `service-${String(index)}`,
                  serviceName: name,
                  environmentId: TARGET.environmentId,
                  source: SOURCE_SERVICES.includes(
                    name as (typeof SOURCE_SERVICES)[number],
                  )
                    ? null
                    : { repo: null, image: `railway/${name.toLowerCase()}` },
                },
              })),
            },
            volumeInstances: {
              edges: DATABASE_SERVICES.map((name, offset) => {
                const index = SOURCE_SERVICES.length + offset
                return {
                  node: {
                    id: `volume-instance-${String(index)}`,
                    serviceId: `service-${String(index)}`,
                    environmentId: TARGET.environmentId,
                    deletedAt: null,
                    isPendingDeletion: false,
                    volume: {
                      id: `volume-${String(index)}`,
                      name: `${name} volume`,
                    },
                  },
                }
              }),
            },
          },
        },
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

function baselineConfig(): Record<string, unknown> {
  return {
    services: {
      'service-web': {
        variables: { EXISTING_SERVICE_VALUE: { value: 'unchanged-service' } },
      },
    },
    sharedVariables: {
      EXISTING_SHARED_VALUE: {
        value: 'unchanged-shared',
        description: 'must survive exactly',
      },
    },
    volumes: {},
    buckets: {},
    privateNetworkDisabled: false,
  }
}

type RailwayHarness = Readonly<{
  railway: RailwayGoogleContentApprovalActivationExecutor
  commands: Array<Readonly<{ args: readonly string[]; stdin?: string }>>
  config: () => Record<string, unknown>
}>

function railwayHarness(
  initialConfig = baselineConfig(),
  mutateAfterEdit?: (config: Record<string, unknown>) => void,
): RailwayHarness {
  const config = structuredClone(initialConfig)
  const commands: Array<Readonly<{ args: readonly string[]; stdin?: string }>> = []
  const railway: RailwayGoogleContentApprovalActivationExecutor = (
    args,
    _environment,
    stdin,
  ) => {
    commands.push({ args: [...args], ...(stdin === undefined ? {} : { stdin }) })
    const command = args.join(' ')
    if (command === '--version') {
      return { status: 0, stdout: 'railway 5.45.2', stderr: '' }
    }
    if (command === 'status --json') {
      return { status: 0, stdout: foundationStatus(), stderr: '' }
    }
    if (command.includes('config plan')) {
      return { status: 0, stdout: foundationNoDriftPlan(), stderr: '' }
    }
    if (command.startsWith('environment config ')) {
      return { status: 0, stdout: JSON.stringify(config), stderr: '' }
    }
    if (command.startsWith('environment edit ')) {
      const patch = JSON.parse(stdin ?? '{}') as {
        sharedVariables?: Record<string, Record<string, unknown>>
      }
      const shared = config.sharedVariables as Record<string, Record<string, unknown>>
      for (const [key, value] of Object.entries(patch.sharedVariables ?? {})) {
        shared[key] = { ...(shared[key] ?? {}), ...value }
      }
      mutateAfterEdit?.(config)
      return {
        status: 0,
        stdout: JSON.stringify({
          staged: true,
          committed: true,
          environmentId: TARGET.environmentId,
          environmentName: TARGET.environmentName,
          message: 'CHANGE-123',
        }),
        stderr: '',
      }
    }
    throw new Error(`unexpected Railway command: ${command}`)
  }
  return { railway, commands, config: () => structuredClone(config) }
}

function databaseHarness(events: string[] = []): Readonly<{
  database: GoogleContentApprovalActivationDatabase
  installed: Map<GoogleContentCapability, string>
}> {
  const installed = new Map<GoogleContentCapability, string>()
  const database: GoogleContentApprovalActivationDatabase = {
    inspect: async () => ({
      killedCapabilities: GOOGLE_CONTENT_CAPABILITIES,
      activeWorkCapabilities: [],
      activeCleanupCapabilities: [],
      matchingApprovalCandidateSha256: Object.fromEntries(installed),
    }),
    ensureApproval: async (bundle) => {
      const capability = bundle.candidate.binding.capability
      events.push(`db:${capability}`)
      const digest = canonicalGoogleContentSha256(bundle.candidate)
      const inserted = !installed.has(capability)
      installed.set(capability, digest)
      return {
        approvalBindingId: `approval-${capability}`,
        inserted,
      }
    },
  }
  return { database, installed }
}

function writeInputs(directory: string): Readonly<{
  publicKeysPath: string
  bundlePaths: readonly string[]
  bundles: readonly GoogleContentApprovalBundle[]
}> {
  const keys = roleKeys()
  const publicKeysPath = join(directory, 'role-public-keys.json')
  writeFileSync(publicKeysPath, JSON.stringify(keys.publicKeys))
  const bundles = GOOGLE_CONTENT_CAPABILITIES.map((capability) =>
    approvalBundle(capability, keys.privateKeys),
  )
  const bundlePaths = bundles.map((bundle, index) => {
    const path = join(directory, `bundle-${String(index)}.json`)
    writeFileSync(path, JSON.stringify(bundle))
    return path
  })
  return { publicKeysPath, bundlePaths, bundles }
}

function planArgs(intentPath: string, inputs: ReturnType<typeof writeInputs>): string[] {
  return [
    'plan',
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
    '--ticket',
    'CHANGE-123',
    '--public-keys',
    inputs.publicKeysPath,
    ...inputs.bundlePaths.flatMap((path) => ['--bundle', path]),
  ]
}

function reviewedArgs(
  mode: 'apply' | 'recover' | 'verify',
  intentPath: string,
): string[] {
  const digest = createHash('sha256').update(readFileSync(intentPath)).digest('hex')
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
    '--intent-sha256',
    digest,
    ...(mode === 'verify'
      ? []
      : [
          '--operator',
          'operator@example.test',
          '--reason',
          'activate reviewed Google Content authority',
          '--ticket',
          'CHANGE-123',
        ]),
  ]
}

describe('Railway Google Content approval activation', () => {
  it('plans one private canonical intent for all four capabilities and the exact cell-us target', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const reversedInputs = {
      ...inputs,
      bundlePaths: [...inputs.bundlePaths].reverse(),
    }
    const railway = railwayHarness()
    const database = databaseHarness()

    await expect(
      runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, reversedInputs), {
        railway: railway.railway,
        database: database.database,
        clock: () => NOW,
      }),
    ).resolves.toBe(0)

    const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as Record<string, unknown>
    expect(intent).toMatchObject({
      version: 'repkey-google-content-approval-activation-1',
      ticket: 'CHANGE-123',
      project: { id: TARGET.projectId, name: TARGET.projectName },
      environment: { id: TARGET.environmentId, name: TARGET.environmentName },
    })
    expect(Object.keys(intent.runtimeBindings as Record<string, unknown>).sort()).toEqual(
      [...GOOGLE_CONTENT_CAPABILITIES].sort(),
    )
    expect(intent.bundles).toHaveLength(4)
    expect(
      (
        intent.bundles as Array<{
          bundle: GoogleContentApprovalBundle
        }>
      ).map(({ bundle }) => bundle.candidate.binding.capability),
    ).toEqual(GOOGLE_CONTENT_CAPABILITIES)
    expect(statSync(intentPath).mode & 0o777).toBe(0o600)
    expect(database.installed.size).toBe(0)
    expect(
      railway.commands.some(({ args }) => args.join(' ').startsWith('environment edit ')),
    ).toBe(false)
  })

  it('installs every approval before one two-variable Railway commit and verifies exact readback', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const events: string[] = []
    const railway = railwayHarness()
    const originalRailway = railway.railway
    const railwayWithEvents: RailwayGoogleContentApprovalActivationExecutor = (
      args,
      environment,
      stdin,
    ) => {
      if (args[0] === 'environment' && args[1] === 'edit') events.push('railway:edit')
      return originalRailway(args, environment, stdin)
    }
    const database = databaseHarness(events)
    const mutations: Array<Record<string, string>> = []
    const runMutation = async (
      input: Readonly<{ operator: string; reason: string; ticket: string }>,
      action: () => Promise<void>,
    ) => {
      mutations.push(input)
      await action()
      return 0
    }

    expect(
      await runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, inputs), {
        railway: railwayWithEvents,
        database: database.database,
        clock: () => NOW,
      }),
    ).toBe(0)
    expect(
      await runRailwayGoogleContentApprovalActivationCli(
        reviewedArgs('apply', intentPath),
        {
          railway: railwayWithEvents,
          database: database.database,
          clock: () => NOW,
          runMutation,
        },
      ),
    ).toBe(0)

    expect(events.slice(0, 4)).toEqual(
      GOOGLE_CONTENT_CAPABILITIES.map((capability) => `db:${capability}`),
    )
    expect(events[4]).toBe('railway:edit')
    expect(mutations).toEqual([
      {
        operator: 'operator@example.test',
        reason: 'activate reviewed Google Content authority',
        ticket: 'CHANGE-123',
      },
    ])
    const edits = railway.commands.filter(
      ({ args }) => args[0] === 'environment' && args[1] === 'edit',
    )
    expect(edits).toHaveLength(1)
    const patch = JSON.parse(edits[0]!.stdin ?? '{}') as {
      sharedVariables: Record<string, { value: string }>
    }
    expect(Object.keys(patch.sharedVariables).sort()).toEqual([
      'GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON',
      'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON',
    ])
    expect(
      JSON.parse(patch.sharedVariables.GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON!.value),
    ).toEqual(
      Object.fromEntries(
        inputs.bundles.map((bundle) => [
          bundle.candidate.binding.capability,
          runtimeBinding(bundle),
        ]),
      ),
    )
    expect(
      JSON.parse(
        patch.sharedVariables.GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON!.value,
      ),
    ).toEqual(JSON.parse(readFileSync(inputs.publicKeysPath, 'utf8')))
    expect(railway.config()).toMatchObject({
      sharedVariables: {
        EXISTING_SHARED_VALUE: {
          value: 'unchanged-shared',
          description: 'must survive exactly',
        },
      },
      services: baselineConfig().services,
    })
    expect(
      await runRailwayGoogleContentApprovalActivationCli(
        reviewedArgs('verify', intentPath),
        {
          railway: railwayWithEvents,
          database: database.database,
          clock: () => NOW,
        },
      ),
    ).toBe(0)
    expect(
      railway.commands.filter(
        ({ args }) => args[0] === 'environment' && args[1] === 'edit',
      ),
    ).toHaveLength(1)
  })

  it('recovers after all database rows exist without appending duplicates', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const railway = railwayHarness()
    const database = databaseHarness()
    const runMutation = async (
      _input: Readonly<{ operator: string; reason: string; ticket: string }>,
      action: () => Promise<void>,
    ) => {
      await action()
      return 0
    }

    expect(
      await runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, inputs), {
        railway: railway.railway,
        database: database.database,
        clock: () => NOW,
      }),
    ).toBe(0)
    for (const bundle of inputs.bundles) {
      database.installed.set(
        bundle.candidate.binding.capability,
        canonicalGoogleContentSha256(bundle.candidate),
      )
    }
    expect(
      await runRailwayGoogleContentApprovalActivationCli(
        reviewedArgs('recover', intentPath),
        {
          railway: railway.railway,
          database: database.database,
          clock: () => NOW,
          runMutation,
        },
      ),
    ).toBe(0)
    expect(database.installed.size).toBe(4)
    expect(
      railway.commands.filter(
        ({ args }) => args[0] === 'environment' && args[1] === 'edit',
      ),
    ).toHaveLength(1)
  })

  it('fails closed when Railway changes any unrelated configuration during the commit', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const railway = railwayHarness(baselineConfig(), (config) => {
      const services = config.services as Record<string, Record<string, unknown>>
      services['service-web'] = { variables: { UNRELATED_DRIFT: { value: 'changed' } } }
    })
    const database = databaseHarness()
    const runMutation = async (
      _input: Readonly<{ operator: string; reason: string; ticket: string }>,
      action: () => Promise<void>,
    ) => {
      try {
        await action()
        return 0
      } catch {
        return 1
      }
    }

    expect(
      await runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, inputs), {
        railway: railway.railway,
        database: database.database,
        clock: () => NOW,
      }),
    ).toBe(0)
    expect(
      await runRailwayGoogleContentApprovalActivationCli(
        reviewedArgs('apply', intentPath),
        {
          railway: railway.railway,
          database: database.database,
          clock: () => NOW,
          runMutation,
        },
      ),
    ).toBe(1)
    expect(database.installed.size).toBe(4)
  })

  it('refuses a role-key rotation that reuses any existing runtime binding', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const differentKeys = roleKeys().publicKeys
    const current = baselineConfig()
    const shared = current.sharedVariables as Record<string, unknown>
    shared.GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON = {
      value: JSON.stringify(
        Object.fromEntries(
          inputs.bundles.map((bundle) => [
            bundle.candidate.binding.capability,
            runtimeBinding(bundle),
          ]),
        ),
      ),
    }
    shared.GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON = {
      value: JSON.stringify(differentKeys),
    }
    const railway = railwayHarness(current)
    const database = databaseHarness()

    await expect(
      runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, inputs), {
        railway: railway.railway,
        database: database.database,
        clock: () => NOW,
      }),
    ).resolves.toBe(1)
    expect(existsSync(intentPath)).toBe(false)
    expect(database.installed.size).toBe(0)
  })

  it('refuses mutation unless all four capabilities are killed and drained', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const railway = railwayHarness()
    const base = databaseHarness()
    const unsafeDatabase: GoogleContentApprovalActivationDatabase = {
      ...base.database,
      inspect: async () => ({
        killedCapabilities: GOOGLE_CONTENT_CAPABILITIES.filter(
          (capability) => capability !== 'property.publish_reply',
        ),
        activeWorkCapabilities: ['property.publish_reply'],
        activeCleanupCapabilities: [],
        matchingApprovalCandidateSha256: {},
      }),
    }

    await expect(
      runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, inputs), {
        railway: railway.railway,
        database: unsafeDatabase,
        clock: () => NOW,
      }),
    ).resolves.toBe(1)
    expect(base.installed.size).toBe(0)
    expect(
      railway.commands.some(
        ({ args }) => args[0] === 'environment' && args[1] === 'edit',
      ),
    ).toBe(false)
  })

  it('rejects an inherited environment-scoped Railway credential before any command', async () => {
    const directory = temporaryDirectory()
    const intentPath = join(directory, 'activation-intent.json')
    const inputs = writeInputs(directory)
    const railway = railwayHarness()
    const database = databaseHarness()
    vi.stubEnv('RAILWAY_TOKEN', 'environment-scoped-token')

    await expect(
      runRailwayGoogleContentApprovalActivationCli(planArgs(intentPath, inputs), {
        railway: railway.railway,
        database: database.database,
        clock: () => NOW,
      }),
    ).resolves.toBe(1)
    expect(railway.commands).toEqual([])
    expect(database.installed.size).toBe(0)
  })
})
