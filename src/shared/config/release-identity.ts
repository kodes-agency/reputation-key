export type ReleaseIdentityEnv = Readonly<{
  NODE_ENV?: string
  RELEASE_SHA?: string
  IMAGE_SOURCE_REVISION?: string
}>

function isConcreteRevision(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value !== 'unknown'
}

/**
 * Refuse a production process whose declared candidate does not match the
 * revision baked into its image.
 *
 * The message names the two VARIABLES and the fix, never their values, so it
 * stays safe to paste into an operational ticket. Omitting the variable names
 * was measured on 2026-08-21: it turned a one-line correction into a failed
 * `web` deploy plus a crashed worker, because the runbook moved `RELEASE_SHA`
 * while `IMAGE_SOURCE_REVISION` is baked from the separate `SOURCE_REVISION`
 * build argument. See ADR 0051.
 */
export function assertReleaseIdentity(env: ReleaseIdentityEnv): void {
  if (env.NODE_ENV !== 'production') return
  if (
    !isConcreteRevision(env.RELEASE_SHA) ||
    !isConcreteRevision(env.IMAGE_SOURCE_REVISION)
  ) {
    return
  }
  if (env.RELEASE_SHA !== env.IMAGE_SOURCE_REVISION) {
    throw new Error(
      '[CONFIG] Production boot refused — RELEASE_SHA does not match the revision ' +
        'baked into this image (IMAGE_SOURCE_REVISION). They are one fact with two ' +
        'names: set RELEASE_SHA and the SOURCE_REVISION build argument to the same ' +
        'revision, on every service, in the same step, then redeploy.',
    )
  }
}
