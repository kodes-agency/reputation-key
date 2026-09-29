// `pnpm ops check-google-oauth` — ask Google whether it accepts the closed
// beta's "Connect Google" (callback address and client secret). Read-only.

import { verifyClosedBetaGoogleOAuth } from './deploy-ci-images'

void verifyClosedBetaGoogleOAuth()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `ops:check-google-oauth failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
