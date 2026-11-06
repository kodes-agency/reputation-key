import { describe, expect, it, vi } from 'vitest'
import { railwayServiceManifest } from '../../src/shared/release/railway-service-settings.test-fixtures'
import { parseCiImageDigestMap } from './ci-image-digest-map'
import { digestMapValue, REVISION } from './ci-image-digest-map.test-fixtures'
import type { CommandRunner } from './command-runner'
import {
  applyClosedBetaImageDeployment,
  buildClosedBetaImageDeploymentPlan,
  CLOSED_BETA_IMAGE_SERVICES,
} from './deploy-ci-images'

describe('image promotion service settings', () => {
  const cases = ['web', 'worker'].flatMap((serviceName) =>
    [false, true].flatMap((alreadyRunning) =>
      ['monitoring', 'replicas', 'manifest', null].map((fault) => ({
        serviceName,
        alreadyRunning,
        fault,
      })),
    ),
  )
  it.each(cases)(
    'checks $serviceName settings (already running: $alreadyRunning, fault: $fault)',
    async ({ serviceName, alreadyRunning, fault }) => {
      const service = CLOSED_BETA_IMAGE_SERVICES.find(
        (entry) => entry.serviceName === serviceName,
      )!
      const inventory = [
        {
          id: service.serviceId,
          name: serviceName,
          source: null,
          status: 'SUCCESS',
          deploymentStopped: false,
          deploymentId: 'before',
          configuredReplicas: 1,
          runningReplicas: 1,
          crashedReplicas: 0,
        },
      ]
      const digestMap = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION)
      if (alreadyRunning) {
        const image = digestMap.images[service.imageName]
        Object.assign(inventory[0]!, {
          source: { repo: null, image: `${image.repository}@${image.digest}` },
        })
      }
      // Planning requires all fixed services; this test promotes only its target.
      const plan = buildClosedBetaImageDeploymentPlan(
        digestMap,
        CLOSED_BETA_IMAGE_SERVICES.map((entry) => ({
          ...inventory[0]!,
          id: entry.serviceId,
          name: entry.serviceName,
        })),
      ).filter((entry) => entry.serviceName === serviceName)
      let deployed = false
      const runner: CommandRunner = (command, args) => {
        let value: unknown = {}
        if (command === 'git') value = { entries: [] }
        if (args[0] === 'service' && args[1] === 'list')
          value = inventory.map((entry) => ({
            ...entry,
            latestDeployment: { id: deployed ? 'after' : 'before' },
            replicas: {
              configured: fault === 'replicas' ? 2 : 1,
              running: 2,
              crashed: 0,
            },
          }))
        if (args[0] === 'service' && args[1] === 'source') deployed = true
        if (args[0] === 'deployment') {
          const manifest = railwayServiceManifest(serviceName)
          if (fault === 'monitoring')
            manifest.deploy.startCommand = 'node without-monitoring.js'
          value = [
            {
              id: deployed ? 'after' : 'before',
              status: 'SUCCESS',
              meta: {
                imageDigest: plan[0]!.digest,
                serviceManifest: fault === 'manifest' ? undefined : manifest,
              },
            },
          ]
        }
        return {
          status: 0,
          stdout:
            args[0] === 'variable' && args[1] === 'list'
              ? `RELEASE_SHA=${REVISION}\n`
              : JSON.stringify(value),
          stderr: '',
        }
      }
      const fetchStub = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }))
      try {
        const result = applyClosedBetaImageDeployment({ plan, runner, out: () => {} })
        if (fault) {
          await expect(result).rejects.toThrow(
            `${serviceName} deployment does not match required service settings`,
          )
          expect(fetchStub).not.toHaveBeenCalled()
        } else {
          await expect(result).resolves.toEqual([
            { serviceName, deploymentId: alreadyRunning ? 'before' : 'after' },
          ])
        }
      } finally {
        fetchStub.mockRestore()
      }
    },
  )
})
