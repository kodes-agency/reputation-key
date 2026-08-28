import { sourceTreeDigest } from './iac-digest'

/**
 * Local sources that can authorize, target, execute, or verify a beta release.
 *
 * This is intentionally broader than the Railway graph digest. A signed
 * manifest must bind the controller code itself and the policy/database code
 * it trusts, not only the graph that the controller asks Railway to render.
 */
export const RELEASE_AUTHORITY_SOURCE_PATHS = Object.freeze([
  '.railway',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/ops/operator-command.ts',
  'scripts/release',
  'src/contexts/identity',
  'src/contexts/property',
  'src/contexts/team',
  'src/shared',
  'tsconfig.json',
  'tsconfig.scripts.json',
] as const)

const SHA256 = /^[0-9a-f]{64}$/u

export function releaseControllerSourceDigest(root = process.cwd()): string {
  return sourceTreeDigest(RELEASE_AUTHORITY_SOURCE_PATHS, root)
}

/** Refuse a local release controller that is not the CI-signed authority. */
export function assertReleaseControllerSourceDigest(
  signedSha256: string,
  currentSha256 = releaseControllerSourceDigest(),
): void {
  if (!SHA256.test(signedSha256)) {
    throw new Error('signed release-controller digest is invalid')
  }
  if (!SHA256.test(currentSha256)) {
    throw new Error('local release-controller digest is invalid')
  }
  if (currentSha256 !== signedSha256) {
    throw new Error(
      `local release-controller digest ${currentSha256} does not match signed ${signedSha256}`,
    )
  }
}
