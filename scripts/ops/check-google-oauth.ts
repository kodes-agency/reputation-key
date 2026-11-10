// `pnpm ops check-google-oauth` — ask Google whether it accepts the closed
// beta's "Connect Google" (callback address and client secret). Read-only.

if (process.argv.includes('--help')) {
  console.log('usage: pnpm ops check-google-oauth')
  process.exit(0)
}

void import('./deploy-ci-images')
  .then(({ verifyClosedBetaGoogleOAuth }) => verifyClosedBetaGoogleOAuth())
  .then((ok) => {
    process.exitCode = ok ? 0 : 1
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `ops:check-google-oauth failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
