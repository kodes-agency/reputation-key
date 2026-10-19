// A digest map as main CI writes it, for the tests of the modules that read one.

import {
  CI_IMAGE_DIGEST_MAP_VERSION,
  CI_PRODUCTION_IMAGE_NAMES,
  TRUSTED_CI_WORKFLOW,
  TRUSTED_REPOSITORY,
} from './ci-image-digest-map'

export const REVISION = 'a'.repeat(40)

export function digestMapValue(): Record<string, unknown> {
  return {
    version: CI_IMAGE_DIGEST_MAP_VERSION,
    sourceRevision: REVISION,
    source: {
      repository: TRUSTED_REPOSITORY,
      ref: 'refs/heads/main',
      workflow: TRUSTED_CI_WORKFLOW,
      runId: '33891370093',
      runAttempt: 1,
    },
    images: Object.fromEntries(
      CI_PRODUCTION_IMAGE_NAMES.map((imageName, index) => [
        imageName,
        {
          repository: `ghcr.io/kodes-agency/repkey-${imageName}`,
          digest: `sha256:${String(index + 1).repeat(64)}`,
          sourceRevision: REVISION,
        },
      ]),
    ),
  }
}
