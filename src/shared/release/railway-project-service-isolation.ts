export const SINGLE_US_BETA_RAILWAY_SERVICE_NAMES = Object.freeze([
  'schema-migrator',
  'google-provider-redis',
  'web',
  'worker',
  'google-execution-admission',
  'google-egress-gateway',
  'ai-execution-admission',
  'ai-egress-gateway',
] as const)

export type SingleUsBetaRailwayServiceName =
  (typeof SINGLE_US_BETA_RAILWAY_SERVICE_NAMES)[number]

const SINGLE_US_BETA_RAILWAY_DATABASE_SERVICE_NAMES = Object.freeze([
  'Postgres',
  'Cache Redis',
  'Queue Redis',
] as const)

const SINGLE_US_BETA_RAILWAY_BUCKET_NAME = 'object-store' as const

type ProjectService = Readonly<{
  id: string
  name: string
}>

type ProjectBucket = Readonly<{
  id: string
  name: string
}>

type EnvironmentServiceSource = Readonly<{
  repo: string | null
  image: string | null
}>

type EnvironmentServiceInstance = Readonly<{
  id: string
  serviceId: string
  serviceName: string
  environmentId: string
  source: EnvironmentServiceSource | null
}>

type EnvironmentVolumeInstance = Readonly<{
  id: string
  serviceId: string
  environmentId: string
  deletedAt: unknown
  isPendingDeletion: boolean
  volumeId: string
  volumeName: string
}>

type ProjectEnvironment = Readonly<{
  id: string
  name: string
  canAccess: boolean
  deletedAt: unknown
  unmergedChangesCount: number
  serviceInstances: readonly EnvironmentServiceInstance[]
  volumeInstances: readonly EnvironmentVolumeInstance[]
}>

export type RailwayProjectServiceInventory = Readonly<{
  projectId: string
  projectName: string
  deletedAt: unknown
  buckets: readonly ProjectBucket[]
  services: readonly ProjectService[]
  environments: readonly ProjectEnvironment[]
}>

export type SingleUsBetaRailwayProjectTarget = Readonly<{
  projectId: string
  projectName: string
  environmentId: string
  environmentName: 'cell-us'
}>

export type SingleUsBetaRailwayProjectIsolation = Readonly<{
  target: SingleUsBetaRailwayProjectTarget
  services: Readonly<
    Record<
      SingleUsBetaRailwayServiceName,
      Readonly<{ serviceId: string; serviceInstanceId: string }>
    >
  >
}>

type JsonRecord = Record<string, unknown>

/**
 * The exact-one-environment proof needs project-wide visibility. Railway's
 * `RAILWAY_TOKEN` is environment scoped and takes precedence when present, so
 * it must never be inherited by a controller that relies on full status.
 */
export function assertRailwayFullProjectVisibilityCredential(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.RAILWAY_TOKEN?.trim()) {
    throw new Error(
      'RAILWAY_TOKEN project credentials cannot prove the sole cell-us environment; use a logged-in user or RAILWAY_API_TOKEN with account/workspace visibility',
    )
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Railway project status omitted ${label}`)
  }
  return value as JsonRecord
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Railway project status omitted ${label}`)
  }
  return value.trim()
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Railway project status omitted ${label}`)
  }
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return nonEmptyString(value, label)
}

function serviceSource(value: unknown, label: string): EnvironmentServiceSource | null {
  if (value === null) return null
  const source = record(value, label)
  return Object.freeze({
    repo: nullableString(source.repo, `${label}.repo`),
    image: nullableString(source.image, `${label}.image`),
  })
}

function edges(value: unknown, label: string): readonly JsonRecord[] {
  const connection = record(value, label)
  if (!Array.isArray(connection.edges)) {
    throw new Error(`Railway project status omitted ${label}.edges`)
  }
  return connection.edges.map((edge, index) =>
    record(
      record(edge, `${label}.edges[${String(index)}]`).node,
      `${label}.edges[${String(index)}].node`,
    ),
  )
}

/**
 * Railway CLI 5.45.2 returns every project environment only when status JSON
 * is requested without explicit selectors. The caller must pin the project
 * and environment through RAILWAY_PROJECT_ID/RAILWAY_ENVIRONMENT_ID instead;
 * adding --project/--environment would hide sibling instances from this guard.
 */
export function railwayFullProjectStatusArgs(): readonly ['status', '--json'] {
  return Object.freeze(['status', '--json'] as const)
}

/** Parse only the non-secret project/service identity fields used by the guard. */
export function parseRailwayProjectServiceInventory(
  output: string,
): RailwayProjectServiceInventory {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway project status is not valid JSON')
  }
  const project = record(value, 'project')
  const buckets = edges(project.buckets, 'buckets').map((bucket, index) =>
    Object.freeze({
      id: nonEmptyString(bucket.id, `buckets[${String(index)}].id`),
      name: nonEmptyString(bucket.name, `buckets[${String(index)}].name`),
    }),
  )
  const services = edges(project.services, 'services').map((service, index) =>
    Object.freeze({
      id: nonEmptyString(service.id, `services[${String(index)}].id`),
      name: nonEmptyString(service.name, `services[${String(index)}].name`),
    }),
  )
  const environments = edges(project.environments, 'environments').map(
    (environment, environmentIndex) => {
      if (typeof environment.canAccess !== 'boolean') {
        throw new Error(
          `Railway project status omitted environments[${String(environmentIndex)}].canAccess`,
        )
      }
      const environmentId = nonEmptyString(
        environment.id,
        `environments[${String(environmentIndex)}].id`,
      )
      const serviceInstances = edges(
        environment.serviceInstances,
        `environments[${String(environmentIndex)}].serviceInstances`,
      ).map((instance, instanceIndex) =>
        Object.freeze({
          id: nonEmptyString(
            instance.id,
            `environments[${String(environmentIndex)}].serviceInstances[${String(instanceIndex)}].id`,
          ),
          serviceId: nonEmptyString(
            instance.serviceId,
            `environments[${String(environmentIndex)}].serviceInstances[${String(instanceIndex)}].serviceId`,
          ),
          serviceName: nonEmptyString(
            instance.serviceName,
            `environments[${String(environmentIndex)}].serviceInstances[${String(instanceIndex)}].serviceName`,
          ),
          environmentId: nonEmptyString(
            instance.environmentId,
            `environments[${String(environmentIndex)}].serviceInstances[${String(instanceIndex)}].environmentId`,
          ),
          source: serviceSource(
            instance.source,
            `environments[${String(environmentIndex)}].serviceInstances[${String(instanceIndex)}].source`,
          ),
        }),
      )
      const volumeInstances = edges(
        environment.volumeInstances,
        `environments[${String(environmentIndex)}].volumeInstances`,
      ).map((instance, instanceIndex) => {
        if (typeof instance.isPendingDeletion !== 'boolean') {
          throw new Error(
            `Railway project status omitted environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].isPendingDeletion`,
          )
        }
        const volume = record(
          instance.volume,
          `environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].volume`,
        )
        return Object.freeze({
          id: nonEmptyString(
            instance.id,
            `environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].id`,
          ),
          serviceId: nonEmptyString(
            instance.serviceId,
            `environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].serviceId`,
          ),
          environmentId: nonEmptyString(
            instance.environmentId,
            `environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].environmentId`,
          ),
          deletedAt: instance.deletedAt,
          isPendingDeletion: instance.isPendingDeletion,
          volumeId: nonEmptyString(
            volume.id,
            `environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].volume.id`,
          ),
          volumeName: nonEmptyString(
            volume.name,
            `environments[${String(environmentIndex)}].volumeInstances[${String(instanceIndex)}].volume.name`,
          ),
        })
      })
      return Object.freeze({
        id: environmentId,
        name: nonEmptyString(
          environment.name,
          `environments[${String(environmentIndex)}].name`,
        ),
        canAccess: environment.canAccess,
        deletedAt: environment.deletedAt,
        unmergedChangesCount: nonNegativeInteger(
          environment.unmergedChangesCount,
          `environments[${String(environmentIndex)}].unmergedChangesCount`,
        ),
        serviceInstances: Object.freeze(serviceInstances),
        volumeInstances: Object.freeze(volumeInstances),
      })
    },
  )
  return Object.freeze({
    projectId: nonEmptyString(project.id, 'project.id'),
    projectName: nonEmptyString(project.name, 'project.name'),
    deletedAt: project.deletedAt,
    buckets: Object.freeze(buckets),
    services: Object.freeze(services),
    environments: Object.freeze(environments),
  })
}

function assertUniqueValues(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Railway project status contains duplicate ${label}`)
  }
}

/**
 * Prove the dedicated project and its sole cell-us environment without
 * requiring services to exist yet. Foundation provisioning and ordinary
 * releases share this identity/isolation boundary; the latter add service
 * instance checks below.
 */
function assertSingleUsBetaRailwayProjectTargetIsolation(
  inventory: RailwayProjectServiceInventory,
  target: Readonly<{
    projectId: string
    projectName: string
    environmentId: string
    environmentName: string
  }>,
): SingleUsBetaRailwayProjectTarget {
  if (inventory.projectId !== target.projectId) {
    throw new Error('Railway project ID does not match the reviewed target')
  }
  if (inventory.projectName !== target.projectName) {
    throw new Error('Railway project name does not match the reviewed target')
  }
  if (inventory.deletedAt !== null) {
    throw new Error('cannot prove service isolation for a deleted Railway project')
  }
  if (target.environmentName !== 'cell-us') {
    throw new Error('Railway service isolation target must be cell-us')
  }
  if (inventory.environments.some((environment) => !environment.canAccess)) {
    throw new Error(
      'cannot prove service isolation while a Railway environment is inaccessible',
    )
  }
  if (inventory.environments.some((environment) => environment.deletedAt !== null)) {
    throw new Error(
      'cannot prove service isolation while a Railway environment is deleted',
    )
  }
  if (
    inventory.environments.some((environment) => environment.unmergedChangesCount !== 0)
  ) {
    throw new Error(
      'cannot prove service isolation while a Railway environment has unmerged changes',
    )
  }
  if (inventory.environments.length !== 1) {
    throw new Error(
      `dedicated Railway beta project must contain exactly one environment; observed ${String(inventory.environments.length)}`,
    )
  }
  assertUniqueValues(
    inventory.environments.map((environment) => environment.id),
    'environment IDs',
  )

  const targetEnvironments = inventory.environments.filter(
    (environment) => environment.id === target.environmentId,
  )
  if (targetEnvironments.length !== 1) {
    throw new Error(
      `Railway project has ${String(targetEnvironments.length)} environments with the reviewed target ID; expected exactly 1`,
    )
  }
  const targetEnvironment = targetEnvironments[0]
  if (targetEnvironment?.name !== target.environmentName) {
    throw new Error('Railway environment name does not match the reviewed target')
  }

  return Object.freeze({
    projectId: target.projectId,
    projectName: target.projectName,
    environmentId: target.environmentId,
    environmentName: 'cell-us',
  })
}

/**
 * Foundation is valid only in a blank dedicated project. Requiring both the
 * project service catalogue and the sole environment's instance catalogue to
 * be empty makes an existing source impossible to remove or repurpose through
 * the source-less graph, regardless of how Railway classifies a later plan.
 */
export function assertSingleUsBetaRailwayFoundationIsolation(
  inventory: RailwayProjectServiceInventory,
  target: Readonly<{
    projectId: string
    projectName: string
    environmentId: string
    environmentName: string
  }>,
): SingleUsBetaRailwayProjectTarget {
  const isolatedTarget = assertSingleUsBetaRailwayProjectTargetIsolation(
    inventory,
    target,
  )
  if (inventory.services.length !== 0) {
    throw new Error(
      `Railway foundation requires a fresh project with zero services; observed ${String(inventory.services.length)}`,
    )
  }
  if (inventory.buckets.length !== 0) {
    throw new Error(
      `Railway foundation requires zero buckets; observed ${String(inventory.buckets.length)}`,
    )
  }
  const environment = inventory.environments[0]
  const instances = environment?.serviceInstances ?? []
  if (instances.length !== 0) {
    throw new Error(
      `Railway foundation requires zero service instances; observed ${String(instances.length)}`,
    )
  }
  const volumes = environment?.volumeInstances ?? []
  if (volumes.length !== 0) {
    throw new Error(
      `Railway foundation requires zero volume instances; observed ${String(volumes.length)}`,
    )
  }
  return isolatedTarget
}

/**
 * Prove the complete source-less foundation after Railway reports apply
 * completion. In addition to the eight release-managed services, Railway's
 * three managed databases must exist exactly once with one volume each, and
 * the sole object bucket must be present. No runnable source may yet be bound
 * to a release-managed service.
 */
export function assertSingleUsBetaRailwayFoundationReadback(
  inventory: RailwayProjectServiceInventory,
  target: Readonly<{
    projectId: string
    projectName: string
    environmentId: string
    environmentName: string
  }>,
): SingleUsBetaRailwayProjectIsolation {
  const isolation = assertSingleUsBetaRailwayProjectIsolation(inventory, target)
  const expectedServiceNames = [
    ...SINGLE_US_BETA_RAILWAY_SERVICE_NAMES,
    ...SINGLE_US_BETA_RAILWAY_DATABASE_SERVICE_NAMES,
  ]
  assertUniqueValues(
    inventory.services.map((service) => service.name),
    'service names',
  )
  const observedServiceNames = [
    ...inventory.services.map((service) => service.name),
  ].sort()
  if (
    observedServiceNames.length !== expectedServiceNames.length ||
    observedServiceNames.some(
      (name, index) => name !== [...expectedServiceNames].sort()[index],
    )
  ) {
    throw new Error('Railway foundation readback contains an unexpected service set')
  }

  if (
    inventory.buckets.length !== 1 ||
    inventory.buckets[0]?.name !== SINGLE_US_BETA_RAILWAY_BUCKET_NAME
  ) {
    throw new Error('Railway foundation readback must contain only object-store')
  }
  assertUniqueValues(
    inventory.buckets.map((bucket) => bucket.id),
    'bucket IDs',
  )

  const environment = inventory.environments[0]
  if (!environment) {
    throw new Error('Railway foundation readback omitted cell-us')
  }
  const allInstances = environment.serviceInstances
  if (allInstances.length !== expectedServiceNames.length) {
    throw new Error(
      `Railway foundation readback has ${String(allInstances.length)} service instances; expected ${String(expectedServiceNames.length)}`,
    )
  }
  for (const service of inventory.services) {
    const instances = allInstances.filter((instance) => instance.serviceId === service.id)
    if (instances.length !== 1 || instances[0]?.serviceName !== service.name) {
      throw new Error(
        `Railway foundation readback does not bind exactly one ${service.name} instance`,
      )
    }
  }
  for (const serviceName of SINGLE_US_BETA_RAILWAY_SERVICE_NAMES) {
    const instance = allInstances.find(
      (candidate) => candidate.serviceName === serviceName,
    )
    if (instance?.source?.repo || instance?.source?.image) {
      throw new Error(
        `Railway foundation readback found a runnable source on ${serviceName}`,
      )
    }
  }

  const volumes = environment.volumeInstances
  if (volumes.length !== SINGLE_US_BETA_RAILWAY_DATABASE_SERVICE_NAMES.length) {
    throw new Error(
      `Railway foundation readback has ${String(volumes.length)} volume instances; expected ${String(SINGLE_US_BETA_RAILWAY_DATABASE_SERVICE_NAMES.length)}`,
    )
  }
  assertUniqueValues(
    volumes.map((volume) => volume.id),
    'volume instance IDs',
  )
  assertUniqueValues(
    volumes.map((volume) => volume.volumeId),
    'volume IDs',
  )
  const databaseServiceIds = SINGLE_US_BETA_RAILWAY_DATABASE_SERVICE_NAMES.map(
    (name) => inventory.services.find((service) => service.name === name)?.id,
  )
  for (const volume of volumes) {
    if (
      volume.environmentId !== target.environmentId ||
      volume.deletedAt !== null ||
      volume.isPendingDeletion ||
      !databaseServiceIds.includes(volume.serviceId)
    ) {
      throw new Error('Railway foundation readback contains an unexpected volume')
    }
  }
  if (
    databaseServiceIds.some(
      (serviceId) =>
        !serviceId ||
        volumes.filter((volume) => volume.serviceId === serviceId).length !== 1,
    )
  ) {
    throw new Error(
      'Railway foundation readback must bind one volume to each managed database',
    )
  }

  return isolation
}

/**
 * Prove that every service whose source a release may mutate has exactly one
 * instance and that instance belongs to the exact reviewed cell-us target.
 */
export function assertSingleUsBetaRailwayProjectIsolation(
  inventory: RailwayProjectServiceInventory,
  target: Readonly<{
    projectId: string
    projectName: string
    environmentId: string
    environmentName: string
  }>,
): SingleUsBetaRailwayProjectIsolation {
  const isolatedTarget = assertSingleUsBetaRailwayProjectTargetIsolation(
    inventory,
    target,
  )
  assertUniqueValues(
    inventory.services.map((service) => service.id),
    'service IDs',
  )

  const allInstances = inventory.environments.flatMap((environment) =>
    environment.serviceInstances.map((instance) => {
      if (instance.environmentId !== environment.id) {
        throw new Error(
          `Railway service instance ${instance.id} environment ID disagrees with its containing environment`,
        )
      }
      return instance
    }),
  )
  assertUniqueValues(
    allInstances.map((instance) => instance.id),
    'service instance IDs',
  )

  const bindings = Object.fromEntries(
    SINGLE_US_BETA_RAILWAY_SERVICE_NAMES.map((serviceName) => {
      const projectServices = inventory.services.filter(
        (service) => service.name === serviceName,
      )
      if (projectServices.length !== 1) {
        throw new Error(
          `Railway project has ${String(projectServices.length)} services named ${serviceName}; expected exactly 1`,
        )
      }
      const service = projectServices[0]
      const instances = allInstances.filter(
        (instance) => instance.serviceId === service?.id,
      )
      if (instances.length !== 1) {
        throw new Error(
          `${serviceName} service ID has ${String(instances.length)} instances; expected exactly 1`,
        )
      }
      const instance = instances[0]
      if (instance?.environmentId !== target.environmentId) {
        throw new Error(
          `${serviceName} service instance is outside the exact cell-us environment`,
        )
      }
      if (instance.serviceName !== serviceName) {
        throw new Error(
          `${serviceName} service instance reports the wrong Railway service name`,
        )
      }
      return [
        serviceName,
        Object.freeze({
          serviceId: service.id,
          serviceInstanceId: instance.id,
        }),
      ] as const
    }),
  ) as Record<
    SingleUsBetaRailwayServiceName,
    Readonly<{ serviceId: string; serviceInstanceId: string }>
  >

  return Object.freeze({
    target: isolatedTarget,
    services: Object.freeze(bindings),
  })
}
