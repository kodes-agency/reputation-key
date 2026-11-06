/** Independent deployed-manifest examples; do not derive from the validator. */
export function railwayServiceManifest(serviceName: string) {
  return {
    build: { builder: 'RAILPACK' },
    deploy: {
      startCommand:
        serviceName === 'worker'
          ? 'node --import ./dist-worker/worker-observability-preload.js dist-worker/index.js'
          : null,
      preDeployCommand:
        serviceName === 'web' ? ['node dist-worker/migrate-deploy.js'] : [],
      healthcheckPath: serviceName === 'web' ? '/api/health/ready' : null,
      healthcheckTimeout: 120,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      drainingSeconds: 30,
    },
  }
}
