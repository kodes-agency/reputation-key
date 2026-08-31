import { z } from 'zod/v4'

export const RELEASE_RUNNER_LABEL = 'ubuntu-24.04' as const
export const RELEASE_RUNNER_IMAGE_OS = 'ubuntu24' as const
export const RELEASE_RUNNER_ARCHITECTURE = 'X64' as const
export const RELEASE_DOCKER_VERSION = '29.7.2' as const
export const RELEASE_BUILDX_VERSION = '0.32.1' as const
export const RELEASE_BUILDKIT_VERSION = '0.30.0' as const
export const RELEASE_BUILDKIT_IMAGE =
  'moby/buildkit:v0.30.0@sha256:0168606be2315b7c807a03b3d8aa79beefdb31c98740cebdffdfeebf31190c9f' as const

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)

/**
 * Exact release-builder policy plus the GitHub runner image revision observed
 * by each matrix job. The label alone is not immutable, so all roles must
 * report one identical `runnerImageVersion` before the manifest can be signed.
 */
export const releaseBuildToolchainSchema = z
  .object({
    runnerLabel: z.literal(RELEASE_RUNNER_LABEL),
    runnerImageOS: z.literal(RELEASE_RUNNER_IMAGE_OS),
    runnerImageVersion: z.string().trim().min(1).max(128),
    runnerArchitecture: z.literal(RELEASE_RUNNER_ARCHITECTURE),
    dockerVersion: z.literal(RELEASE_DOCKER_VERSION),
    buildxVersion: z.literal(RELEASE_BUILDX_VERSION),
    buildkitVersion: z.literal(RELEASE_BUILDKIT_VERSION),
    buildkitImage: z.literal(RELEASE_BUILDKIT_IMAGE),
    imageMetadataIndexSha256: sha256,
  })
  .strict()

export type ReleaseBuildToolchain = z.infer<typeof releaseBuildToolchainSchema>

export type ReleaseBuildToolchainObservation = Omit<
  ReleaseBuildToolchain,
  'imageMetadataIndexSha256'
>

export function parseReleaseBuildToolchainObservation(
  value: unknown,
): ReleaseBuildToolchainObservation {
  return releaseBuildToolchainSchema.omit({ imageMetadataIndexSha256: true }).parse(value)
}
