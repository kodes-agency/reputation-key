import { z } from 'zod/v4'

/** Service settings required by the signed-image deployment path. */
export const RAILWAY_SERVICE_SETTINGS = {
  web: {
    startCommand:
      'node --import ./.output/server/web-observability-preload.mjs .output/server/index.mjs',
    preDeployCommand: 'node dist-worker/migrate-deploy.js',
    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 120,
    numReplicas: 1,
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 10,
    drainingSeconds: 30,
  },
  worker: {
    startCommand:
      'node --import ./dist-worker/worker-observability-preload.js dist-worker/index.js',
    preDeployCommand: null,
    healthcheckPath: null,
    numReplicas: 1,
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 10,
    drainingSeconds: 30,
  },
} as const

/** Check the deployed manifest, never a repository config Railway may ignore. */
export function assertRailwayServiceSettings(
  serviceName: string,
  serviceManifest: unknown,
  configuredReplicas: number,
): void {
  if (serviceName !== 'web' && serviceName !== 'worker') return
  const settings = RAILWAY_SERVICE_SETTINGS[serviceName]
  const preDeployCommand =
    serviceName === 'web'
      ? z.union([
          z.literal(RAILWAY_SERVICE_SETTINGS.web.preDeployCommand),
          z.tuple([z.literal(RAILWAY_SERVICE_SETTINGS.web.preDeployCommand)]),
        ])
      : z.union([z.null(), z.tuple([])]).optional()
  const result = z
    .object({
      deploy: z.object({
        // Web can inherit the image CMD; worker must override it.
        startCommand:
          serviceName === 'web'
            ? z.literal(settings.startCommand).nullish()
            : z.literal(settings.startCommand),
        preDeployCommand,
        healthcheckPath:
          serviceName === 'web'
            ? z.literal(RAILWAY_SERVICE_SETTINGS.web.healthcheckPath)
            : z.null().optional(),
        ...(serviceName === 'web'
          ? {
              healthcheckTimeout: z.literal(
                RAILWAY_SERVICE_SETTINGS.web.healthcheckTimeout,
              ),
            }
          : {}),
        restartPolicyType: z.literal(settings.restartPolicyType),
        restartPolicyMaxRetries: z.literal(settings.restartPolicyMaxRetries),
        drainingSeconds: z.literal(settings.drainingSeconds),
      }),
    })
    .safeParse(serviceManifest)
  if (!result.success || configuredReplicas !== settings.numReplicas) {
    throw new Error(`${serviceName} deployment does not match required service settings`)
  }
}
