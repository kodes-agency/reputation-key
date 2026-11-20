// Environment variables a server-function test file runs under.
//
// They are written to process.env, so the container and every getEnv() reader
// (client IP, Organization suspension, Better Auth when first built) parse the
// same values the app would; the file's previous values come back afterwards.

import { resetEnv } from '#/shared/config/env'

export type EnvOverlay = Readonly<Record<string, string | undefined>>

/** Apply `overlay` to process.env and return the function that restores it. */
export function applyEnvOverlay(overlay: EnvOverlay): () => void {
  const previous = Object.fromEntries(
    Object.keys(overlay).map((key) => [key, process.env[key]]),
  )
  const write = (values: EnvOverlay) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetEnv()
  }
  write(overlay)
  return () => write(previous)
}
