// BQC-8.2: sandbox stub process for the local staging cell.
//
// Long-running child of `pnpm perf:cell up` — serves one e2e sandbox stub
// (GBP or mail) on the cell's port until `perf:cell down` SIGTERMs it. All
// logic lives in the e2e fixtures (reused unmodified); this is the process
// wrapper that lets the stubs outlive the `up` command.
//
// Usage: pnpm tsx scripts/perf/cell-stub-server.ts --kind=gbp --port=4150
//        pnpm tsx scripts/perf/cell-stub-server.ts --kind=mail --port=4151

import { readFileSync } from 'node:fs'
import { startAiProviderStub } from '../../e2e/fixtures/ai-provider-stub'
import { startGbpStub } from '../../e2e/fixtures/gbp-stub'
import { startMailStub } from '../../e2e/fixtures/mail-stub'

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

async function main(): Promise<void> {
  const kind = argValue('--kind')
  const port = Number(argValue('--port'))
  if (
    (kind !== 'gbp' && kind !== 'mail' && kind !== 'ai') ||
    !Number.isInteger(port) ||
    port <= 0
  ) {
    console.error('Usage: cell-stub-server.ts --kind=<gbp|mail|ai> --port=<n>')
    process.exit(2)
  }

  const host = process.env.BQC_STUB_HOST ?? '127.0.0.1'
  const certPath = process.env.BQC_STUB_TLS_CERT_PATH
  const keyPath = process.env.BQC_STUB_TLS_KEY_PATH
  if ((certPath === undefined) !== (keyPath === undefined)) {
    throw new Error('stub TLS certificate and key must be configured together')
  }
  const tls =
    certPath && keyPath
      ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
      : undefined
  const stub =
    kind === 'gbp'
      ? await startGbpStub(port, host, tls)
      : kind === 'ai'
        ? await startAiProviderStub(port, host, tls)
        : await startMailStub(port, host)
  console.log(`${kind} stub listening on ${stub.host}:${stub.port}`)

  const shutdown = async () => {
    await stub.stop()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((err) => {
  console.error('cell stub server failed:', err)
  process.exit(1)
})
