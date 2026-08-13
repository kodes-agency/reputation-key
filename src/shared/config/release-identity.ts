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
 * revision baked into its image. The error intentionally contains no revision
 * value so it is safe to copy into operational tickets.
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
      '[CONFIG] Production boot refused — RELEASE_SHA does not match the revision baked into this image.',
    )
  }
}
