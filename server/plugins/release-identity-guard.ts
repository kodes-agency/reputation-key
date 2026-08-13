import { definePlugin } from 'nitro'
import { getEnv } from '#/shared/config/env'
import { assertReleaseIdentity } from '#/shared/config/release-identity'

/** Refuse traffic when the declared candidate and baked image differ. */
export default definePlugin(() => {
  assertReleaseIdentity(getEnv())
})
