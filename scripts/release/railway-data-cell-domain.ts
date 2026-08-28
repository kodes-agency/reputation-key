import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
} from '../../.railway/service-source-map'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import {
  SINGLE_US_BETA_RAILWAY_SERVICE_NAMES,
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayFoundationReadback,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from '../../src/shared/release/railway-project-service-isolation'
import { railwayPlanArgs } from '../../src/shared/release/railway-plan-evidence'
import { railwayTargetEnvironment } from './railway-data-cell-plan'
import { assertSingleUsBetaRailwayFoundationNoDriftOutput } from './railway-data-cell-foundation'
import {
  MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION,
  assertRailwayCliSupportsPinnedPlans,
} from './staged-railway-sources'

const DOMAIN_INTENT_VERSION = 'repkey-railway-domain-intent-2' as const
const DOMAIN = 'us.reputationkey.app' as const
const TARGET_PORT = 8080 as const
const PROBE_DOMAIN_TYPE = 'railway-service' as const
const SHA256 = /^[0-9a-f]{64}$/u

type JsonRecord = Readonly<Record<string, unknown>>

export type RailwayDomainCommandResult = Readonly<{
  status: number
  stdout: string
  stderr: string
  error?: Error
}>

export type RailwayDomainExecutor = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => RailwayDomainCommandResult

type DomainOptions = Readonly<{
  mode: 'plan' | 'apply' | 'recover' | 'verify'
  projectId: string
  environmentId: string
  intentPath: string
  intentSha256?: string
}>

type DomainIntent = Readonly<{
  version: typeof DOMAIN_INTENT_VERSION
  deploymentProfile: 'production'
  project: Readonly<{ id: string; name: typeof PRODUCTION_RAILWAY_PROJECT_NAME }>
  environment: Readonly<{ id: string; name: 'cell-us' }>
  service: Readonly<{ id: string; instanceId: string; name: 'web' }>
  probeDomain: Readonly<{
    type: typeof PROBE_DOMAIN_TYPE
    targetPort: typeof TARGET_PORT
  }>
  domain: typeof DOMAIN
  targetPort: typeof TARGET_PORT
}>

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const observed = Object.keys(value).sort()
  const allowed = [...expected].sort()
  if (
    observed.length !== allowed.length ||
    observed.some((key, index) => key !== allowed[index])
  ) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

function requiredFlag(args: readonly string[], name: string): string {
  const value = flagValue(args, name)?.trim()
  if (!value) throw new Error(`${name} is required`)
  if (value.length > 255) throw new Error(`${name} is too long`)
  return value
}

function parseOptions(args: readonly string[]): DomainOptions {
  const mode = args[0]
  if (mode !== 'plan' && mode !== 'apply' && mode !== 'recover' && mode !== 'verify') {
    throw new Error('first argument must be plan, apply, recover, or verify')
  }
  if (flagValue(args, '--cell') !== 'us') {
    throw new Error('--cell must be us')
  }
  if (flagValue(args, '--deployment-profile') !== 'production') {
    throw new Error('--deployment-profile must be production')
  }
  const intentSha256 = flagValue(args, '--intent-sha256')
  if (mode !== 'plan' && (!intentSha256 || !SHA256.test(intentSha256))) {
    throw new Error('--intent-sha256 must be the reviewed lowercase sha256')
  }
  return Object.freeze({
    mode,
    projectId: requiredFlag(args, '--project-id'),
    environmentId: requiredFlag(args, '--environment-id'),
    intentPath: resolve(requiredFlag(args, '--intent')),
    ...(intentSha256 ? { intentSha256 } : {}),
  })
}

function defaultRailwayExecutor(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): RailwayDomainCommandResult {
  const result = spawnSync('railway', [...args], { encoding: 'utf8', env: environment })
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  })
}

function railwayCommand(
  railway: RailwayDomainExecutor,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): RailwayDomainCommandResult {
  const result = railway(args, environment)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `railway ${args.join(' ')} exited ${String(result.status)}`,
    )
  }
  return result
}

function assertExactCliVersion(output: string): void {
  assertRailwayCliSupportsPinnedPlans(output)
  const observed = /\b(\d+\.\d+\.\d+)\b/u.exec(output)?.[1]
  if (observed !== MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION) {
    throw new Error(
      `Railway domain registration is pinned to CLI ${MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION}; observed ${observed ?? 'unknown'}`,
    )
  }
}

function foundationIntent(
  options: DomainOptions,
  service: Readonly<{ serviceId: string; serviceInstanceId: string }>,
): DomainIntent {
  return Object.freeze({
    version: DOMAIN_INTENT_VERSION,
    deploymentProfile: 'production',
    project: Object.freeze({
      id: options.projectId,
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
    }),
    environment: Object.freeze({ id: options.environmentId, name: 'cell-us' }),
    service: Object.freeze({
      id: service.serviceId,
      instanceId: service.serviceInstanceId,
      name: 'web',
    }),
    probeDomain: Object.freeze({
      type: PROBE_DOMAIN_TYPE,
      targetPort: TARGET_PORT,
    }),
    domain: DOMAIN,
    targetPort: TARGET_PORT,
  })
}

function intentBytes(intent: DomainIntent): Buffer {
  return Buffer.from(`${JSON.stringify(intent, null, 2)}\n`, 'utf8')
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 255) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

function parseIntent(path: string): Readonly<{ intent: DomainIntent; sha256: string }> {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Railway domain intent must be a regular file')
  }
  const bytes = readFileSync(path)
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Railway domain intent is not valid JSON')
  }
  const intent = record(value, 'Railway domain intent')
  exactKeys(
    intent,
    [
      'version',
      'deploymentProfile',
      'project',
      'environment',
      'service',
      'probeDomain',
      'domain',
      'targetPort',
    ],
    'Railway domain intent',
  )
  const project = record(intent.project, 'Railway domain intent project')
  const environment = record(intent.environment, 'Railway domain intent environment')
  const service = record(intent.service, 'Railway domain intent service')
  const probeDomain = record(intent.probeDomain, 'Railway domain intent probeDomain')
  exactKeys(project, ['id', 'name'], 'Railway domain intent project')
  exactKeys(environment, ['id', 'name'], 'Railway domain intent environment')
  exactKeys(service, ['id', 'instanceId', 'name'], 'Railway domain intent service')
  exactKeys(probeDomain, ['type', 'targetPort'], 'Railway domain intent probeDomain')
  const parsed: DomainIntent = Object.freeze({
    version:
      intent.version === DOMAIN_INTENT_VERSION
        ? DOMAIN_INTENT_VERSION
        : (() => {
            throw new Error('Railway domain intent version is invalid')
          })(),
    deploymentProfile:
      intent.deploymentProfile === 'production'
        ? 'production'
        : (() => {
            throw new Error('Railway domain intent profile is invalid')
          })(),
    project: Object.freeze({
      id: nonEmptyString(project.id, 'Railway domain intent project ID'),
      name:
        project.name === PRODUCTION_RAILWAY_PROJECT_NAME
          ? PRODUCTION_RAILWAY_PROJECT_NAME
          : (() => {
              throw new Error('Railway domain intent project name is invalid')
            })(),
    }),
    environment: Object.freeze({
      id: nonEmptyString(environment.id, 'Railway domain intent environment ID'),
      name:
        environment.name === 'cell-us'
          ? 'cell-us'
          : (() => {
              throw new Error('Railway domain intent environment name is invalid')
            })(),
    }),
    service: Object.freeze({
      id: nonEmptyString(service.id, 'Railway domain intent service ID'),
      instanceId: nonEmptyString(
        service.instanceId,
        'Railway domain intent service instance ID',
      ),
      name:
        service.name === 'web'
          ? 'web'
          : (() => {
              throw new Error('Railway domain intent service name is invalid')
            })(),
    }),
    probeDomain: Object.freeze({
      type:
        probeDomain.type === PROBE_DOMAIN_TYPE
          ? PROBE_DOMAIN_TYPE
          : (() => {
              throw new Error('Railway domain intent probe type is invalid')
            })(),
      targetPort:
        probeDomain.targetPort === TARGET_PORT
          ? TARGET_PORT
          : (() => {
              throw new Error('Railway domain intent probe port is invalid')
            })(),
    }),
    domain:
      intent.domain === DOMAIN
        ? DOMAIN
        : (() => {
            throw new Error('Railway domain intent hostname is invalid')
          })(),
    targetPort:
      intent.targetPort === TARGET_PORT
        ? TARGET_PORT
        : (() => {
            throw new Error('Railway domain intent port is invalid')
          })(),
  })
  if (!intentBytes(parsed).equals(bytes)) {
    throw new Error('Railway domain intent is not canonically encoded')
  }
  return Object.freeze({
    intent: parsed,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}

function domainList(output: string): readonly JsonRecord[] {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway domain list is not valid JSON')
  }
  return array(record(value, 'Railway domain list').domains, 'Railway domains').map(
    (domain, index) => record(domain, `Railway domain[${String(index)}]`),
  )
}

function assertNoExistingDomain(output: string): void {
  if (domainList(output).length !== 0) {
    throw new Error('web must have zero existing domains before registration')
  }
}

function assertRegistrationSyncStatus(
  domain: JsonRecord,
  label: string,
  requireActive = false,
): void {
  const status = domain.syncStatus
  if (
    requireActive ? status !== 'ACTIVE' : status !== 'ACTIVE' && status !== 'CREATING'
  ) {
    throw new Error(`${label} has unsafe Railway syncStatus ${String(status)}`)
  }
}

function probeOriginFromRecord(domain: JsonRecord, requireActive = false): string {
  if (
    domain.type !== 'service' ||
    domain.targetPort !== TARGET_PORT ||
    typeof domain.domain !== 'string'
  ) {
    throw new Error('web probe-domain readback is invalid')
  }
  assertRegistrationSyncStatus(domain, 'web probe domain', requireActive)
  return parseCreatedProbeDomain(JSON.stringify({ domain: `https://${domain.domain}` }))
}

function parseCreatedProbeDomain(output: string): string {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway service domain create output is not valid JSON')
  }
  const origin = nonEmptyString(
    record(value, 'Railway service domain create output').domain,
    'Railway service domain origin',
  )
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error('Railway service domain origin is invalid')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !parsed.hostname.endsWith('.up.railway.app')
  ) {
    throw new Error('Railway service domain origin is outside up.railway.app')
  }
  return parsed.origin
}

function assertProbeDomainReadback(output: string, probeOrigin: string): void {
  const domains = domainList(output)
  if (domains.length !== 1 || probeOriginFromRecord(domains[0] ?? {}) !== probeOrigin) {
    throw new Error('web probe-domain readback does not match the created origin')
  }
}

function parseCreatedDomain(
  output: string,
  intent: DomainIntent,
): Readonly<{ id: string; value: JsonRecord }> {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway domain create output is not valid JSON')
  }
  const created = record(
    record(value, 'Railway domain create output').customDomainCreate,
    'Railway created domain',
  )
  const id = nonEmptyString(created.id, 'Railway created domain ID')
  if (
    created.domain !== intent.domain ||
    created.projectId !== intent.project.id ||
    created.environmentId !== intent.environment.id ||
    created.serviceId !== intent.service.id ||
    created.targetPort !== intent.targetPort ||
    (created.syncStatus !== 'ACTIVE' && created.syncStatus !== 'CREATING')
  ) {
    throw new Error('Railway created the domain outside the reviewed target')
  }
  return Object.freeze({ id, value: created })
}

function assertCreatedDomainReadback(
  output: string,
  intent: DomainIntent,
  domainId: string,
  probeOrigin: string,
  requireActive = false,
): void {
  const domains = domainList(output)
  if (domains.length !== 2) {
    throw new Error('web domain readback must contain the probe and custom domain')
  }
  const domain = domains.find((candidate) => candidate.type === 'custom')
  const probe = domains.find((candidate) => candidate.type === 'service')
  if (
    domain?.id !== domainId ||
    domain.domain !== intent.domain ||
    domain.targetPort !== intent.targetPort ||
    !probe ||
    probeOriginFromRecord(probe, requireActive) !== probeOrigin
  ) {
    throw new Error('web domain readback does not match the reviewed registration')
  }
  assertRegistrationSyncStatus(domain, 'web custom domain', requireActive)
}

function assertExistingDomainReadback(
  output: string,
  intent: DomainIntent,
  requireActive = false,
): string {
  const domains = domainList(output)
  if (domains.length !== 2) {
    throw new Error('web domain readback must contain the probe and custom domain')
  }
  const custom = domains.find((candidate) => candidate.type === 'custom')
  const probe = domains.find((candidate) => candidate.type === 'service')
  if (
    !custom ||
    custom.domain !== intent.domain ||
    custom.targetPort !== intent.targetPort ||
    !probe
  ) {
    throw new Error('web domain readback does not match the reviewed registration')
  }
  assertRegistrationSyncStatus(custom, 'web custom domain', requireActive)
  return probeOriginFromRecord(probe, requireActive)
}

function inspectCustomDomainStatus(output: string, intent: DomainIntent): JsonRecord {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway custom-domain status is not valid JSON')
  }
  const domain = record(record(value, 'Railway domain status').domain, 'Railway domain')
  if (
    domain.domain !== intent.domain ||
    domain.type !== 'custom' ||
    domain.targetPort !== intent.targetPort
  ) {
    throw new Error('Railway custom-domain status targets the wrong registration')
  }
  assertRegistrationSyncStatus(domain, 'web custom domain')
  const dnsRecords = array(domain.dnsRecords, 'Railway domain DNS records')
  if (
    dnsRecords.length === 0 ||
    dnsRecords.some((value) => {
      const recordValue = record(value, 'Railway domain DNS record')
      return (
        typeof recordValue.recordType !== 'string' ||
        typeof recordValue.fqdn !== 'string' ||
        typeof recordValue.requiredValue !== 'string'
      )
    })
  ) {
    throw new Error('Railway custom-domain status omitted required DNS records')
  }
  return domain
}

function assertVerifiedCustomDomainStatus(output: string, intent: DomainIntent): void {
  const domain = inspectCustomDomainStatus(output, intent)
  const verification = record(domain.verification, 'Railway domain verification')
  const certificate = record(domain.certificate, 'Railway domain certificate')
  const certificates = array(domain.certificates, 'Railway domain certificates')
  if (
    domain.syncStatus !== 'ACTIVE' ||
    verification.verified !== true ||
    certificate.status !== 'CERTIFICATE_STATUS_TYPE_VALID' ||
    !certificates.some((value) => {
      const issued = record(value, 'Railway issued certificate')
      return (
        Array.isArray(issued.domainNames) && issued.domainNames.includes(intent.domain)
      )
    })
  ) {
    throw new Error('Railway custom domain is not DNS-verified and certificate-ready')
  }
}

function probeDomainCreateArgs(intent: DomainIntent): readonly string[] {
  return Object.freeze([
    'domain',
    '--port',
    String(intent.probeDomain.targetPort),
    '--project',
    intent.project.id,
    '--environment',
    intent.environment.id,
    '--service',
    intent.service.id,
    '--json',
  ])
}

function domainListArgs(
  intent: DomainIntent,
  serviceId = intent.service.id,
): readonly string[] {
  return Object.freeze([
    'domain',
    'list',
    '--project',
    intent.project.id,
    '--environment',
    intent.environment.id,
    '--service',
    serviceId,
    '--json',
  ])
}

function domainCreateArgs(intent: DomainIntent): readonly string[] {
  return Object.freeze([
    'domain',
    intent.domain,
    '--port',
    String(intent.targetPort),
    '--project',
    intent.project.id,
    '--environment',
    intent.environment.id,
    '--service',
    intent.service.id,
    '--json',
  ])
}

function domainStatusArgs(intent: DomainIntent): readonly string[] {
  return Object.freeze([
    'domain',
    'status',
    intent.domain,
    '--project',
    intent.project.id,
    '--environment',
    intent.environment.id,
    '--service',
    intent.service.id,
    '--json',
  ])
}

function configPullArgs(): readonly string[] {
  return Object.freeze(['config', 'pull', '--json'])
}

function assertPulledCustomDomain(output: string, intent: DomainIntent): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway pulled configuration is not valid JSON')
  }
  const graph = record(value, 'Railway pulled configuration')
  const project = record(graph.project, 'Railway pulled configuration project')
  const resources = array(graph.resources, 'Railway pulled configuration resources').map(
    (resource, index) =>
      record(resource, `Railway pulled configuration resource[${String(index)}]`),
  )
  const webResources = resources.filter(
    (resource) =>
      resource.address === 'service.web' &&
      resource.type === 'service' &&
      resource.name === intent.service.name,
  )
  if (project.name !== intent.project.name || webResources.length !== 1) {
    throw new Error(
      'Railway pulled configuration does not contain the reviewed web target',
    )
  }
  const networking = record(webResources[0]?.networking, 'Railway pulled web networking')
  const customDomains = record(
    networking.customDomains,
    'Railway pulled web custom domains',
  )
  exactKeys(customDomains, [intent.domain], 'Railway pulled web custom domains')
  const domain = record(
    customDomains[intent.domain],
    'Railway pulled production custom domain',
  )
  if (domain.port !== intent.targetPort) {
    throw new Error('Railway pulled custom domain targets the wrong port')
  }
}

export function runRailwayDataCellDomainCli(
  args: readonly string[],
  dependencies: Readonly<{ railway?: RailwayDomainExecutor }> = {},
): number {
  try {
    const options = parseOptions(args)
    const railway = dependencies.railway ?? defaultRailwayExecutor
    if (options.mode === 'plan' && existsSync(options.intentPath)) {
      throw new Error('Railway domain intent path already exists')
    }
    const reviewed = options.mode === 'plan' ? undefined : parseIntent(options.intentPath)
    if (reviewed && reviewed.sha256 !== options.intentSha256) {
      throw new Error('Railway domain intent changed after review')
    }
    if (
      reviewed &&
      (reviewed.intent.project.id !== options.projectId ||
        reviewed.intent.environment.id !== options.environmentId)
    ) {
      throw new Error('Railway domain intent does not target the reviewed IDs')
    }

    const environment = {
      ...railwayTargetEnvironment({
        project: options.projectId,
        name: PRODUCTION_RAILWAY_PROJECT_NAME,
        environment: options.environmentId,
      }),
      RAILWAY_CALLER: process.env.RAILWAY_CALLER ?? 'repo:railway-data-cell-domain',
      RAILWAY_AGENT_SESSION:
        process.env.RAILWAY_AGENT_SESSION ?? 'repkey-production-us-domain',
      REPKEY_RAILWAY_CELL_ENVIRONMENT: 'cell-us',
      REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
      [RAILWAY_SERVICE_SOURCE_MAP_ENV]: CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
    }
    assertRailwayFullProjectVisibilityCredential(environment)
    const version = railwayCommand(railway, ['--version'], environment)
    assertExactCliVersion(`${version.stdout}\n${version.stderr}`)
    const status = railwayCommand(railway, railwayFullProjectStatusArgs(), environment)
    const isolation = assertSingleUsBetaRailwayFoundationReadback(
      parseRailwayProjectServiceInventory(status.stdout),
      {
        projectId: options.projectId,
        projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
        environmentId: options.environmentId,
        environmentName: 'cell-us',
      },
    )
    const foundationNoDrift = railwayCommand(
      railway,
      railwayPlanArgs({ iacFile: '.railway/railway.ts' }),
      environment,
    )
    assertSingleUsBetaRailwayFoundationNoDriftOutput(foundationNoDrift.stdout, {
      deploymentProfile: 'production',
      projectId: options.projectId,
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      environmentId: options.environmentId,
      environmentName: 'cell-us',
    })
    const liveIntent = foundationIntent(options, isolation.services.web)
    if (reviewed && JSON.stringify(reviewed.intent) !== JSON.stringify(liveIntent)) {
      throw new Error('Railway domain target changed after intent review')
    }
    const projectDomainReadbacks = Object.fromEntries(
      SINGLE_US_BETA_RAILWAY_SERVICE_NAMES.map((serviceName) => [
        serviceName,
        railwayCommand(
          railway,
          domainListArgs(liveIntent, isolation.services[serviceName].serviceId),
          environment,
        ),
      ]),
    ) as Readonly<
      Record<
        (typeof SINGLE_US_BETA_RAILWAY_SERVICE_NAMES)[number],
        RailwayDomainCommandResult
      >
    >
    for (const serviceName of SINGLE_US_BETA_RAILWAY_SERVICE_NAMES) {
      if (serviceName !== 'web') {
        assertNoExistingDomain(projectDomainReadbacks[serviceName].stdout)
      }
    }
    const listed = projectDomainReadbacks.web

    if (options.mode === 'plan') {
      assertNoExistingDomain(listed.stdout)
      const bytes = intentBytes(liveIntent)
      writeFileSync(options.intentPath, bytes, { mode: 0o600, flag: 'wx' })
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      process.stdout.write(bytes)
      process.stderr.write(
        `Railway production domain intent retained at ${options.intentPath}; sha256=${sha256}. Review these exact IDs and hostname before apply.\n`,
      )
      return 0
    }

    const immediate = parseIntent(options.intentPath)
    if (immediate.sha256 !== options.intentSha256) {
      throw new Error('Railway domain intent changed immediately before registration')
    }

    if (options.mode === 'verify') {
      const probeOrigin = assertExistingDomainReadback(
        listed.stdout,
        immediate.intent,
        true,
      )
      const domainStatus = railwayCommand(
        railway,
        domainStatusArgs(immediate.intent),
        environment,
      )
      assertVerifiedCustomDomainStatus(domainStatus.stdout, immediate.intent)
      const pulled = railwayCommand(railway, configPullArgs(), environment)
      assertPulledCustomDomain(pulled.stdout, immediate.intent)
      process.stdout.write(
        `${JSON.stringify({ probeOrigin, customDomainStatus: JSON.parse(domainStatus.stdout) }, null, 2)}\n`,
      )
      process.stderr.write(
        `Verified the active production probe, DNS ownership, valid certificate, and retained IaC domain graph for ${DOMAIN}.\n`,
      )
      return 0
    }

    let probeOrigin: string
    if (options.mode === 'apply') {
      assertNoExistingDomain(listed.stdout)
      const probeCreated = railwayCommand(
        railway,
        probeDomainCreateArgs(immediate.intent),
        environment,
      )
      probeOrigin = parseCreatedProbeDomain(probeCreated.stdout)
      const probeReadback = railwayCommand(
        railway,
        domainListArgs(immediate.intent),
        environment,
      )
      assertProbeDomainReadback(probeReadback.stdout, probeOrigin)
    } else {
      const existing = domainList(listed.stdout)
      if (existing.length === 2) {
        probeOrigin = assertExistingDomainReadback(listed.stdout, immediate.intent)
        const domainStatus = railwayCommand(
          railway,
          domainStatusArgs(immediate.intent),
          environment,
        )
        inspectCustomDomainStatus(domainStatus.stdout, immediate.intent)
        process.stdout.write(
          `${JSON.stringify(
            {
              probeOrigin,
              domains: existing,
              customDomainStatus: JSON.parse(domainStatus.stdout),
            },
            null,
            2,
          )}\n`,
        )
        process.stderr.write(
          `Recovered the exact probe and custom-domain readback for ${DOMAIN}; no mutation was needed. Run verify after DNS and certificate issuance.\n`,
        )
        return 0
      }
      if (existing.length !== 1) {
        throw new Error(
          'domain recovery requires exactly the reviewed probe-only partial state or the complete two-domain state',
        )
      }
      probeOrigin = probeOriginFromRecord(existing[0] ?? {})
    }

    const created = railwayCommand(
      railway,
      domainCreateArgs(immediate.intent),
      environment,
    )
    const customDomain = parseCreatedDomain(created.stdout, immediate.intent)
    const readback = railwayCommand(
      railway,
      domainListArgs(immediate.intent),
      environment,
    )
    assertCreatedDomainReadback(
      readback.stdout,
      immediate.intent,
      customDomain.id,
      probeOrigin,
    )
    const domainStatus = railwayCommand(
      railway,
      domainStatusArgs(immediate.intent),
      environment,
    )
    inspectCustomDomainStatus(domainStatus.stdout, immediate.intent)
    process.stdout.write(
      `${JSON.stringify(
        {
          probeOrigin,
          customDomainCreate: customDomain.value,
          customDomainStatus: JSON.parse(domainStatus.stdout),
        },
        null,
        2,
      )}\n`,
    )
    process.stderr.write(
      `Registered the production probe origin and ${DOMAIN} on the exact cell-us web service. Use the probe for pre-DNS health checks, configure the returned custom-domain DNS records, then run the reviewed verify mode before traffic cutover.\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(
      `Railway Data Cell domain refused: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runRailwayDataCellDomainCli(process.argv.slice(2))
}
